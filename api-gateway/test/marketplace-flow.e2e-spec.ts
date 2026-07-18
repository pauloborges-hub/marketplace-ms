/**
 * Full marketplace E2E flow — black-box against REAL running services (no network mocks).
 *
 * Requires all services + RabbitMQ up locally before running:
 *   users-service:3000  products-service:3001  checkout-service:3003
 *   payments-service:3004  api-gateway:3005  rabbitmq:5672
 *
 * NOTE ON GATEWAY COVERAGE: there is a pre-existing gap — the api-gateway does NOT
 * expose cart/checkout/order routes. So, although this is a "via gateway" flow, the
 * cart/checkout/order steps talk DIRECTLY to checkout-service (3003). Only auth,
 * catalog and payment lookups go through the gateway (3005).
 *
 * Run (with services up):
 *   cd api-gateway && npx jest --config test/jest-e2e.json marketplace-flow
 */
import request from 'supertest';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3005';
const CHECKOUT_URL = process.env.CHECKOUT_URL || 'http://localhost:3003';

const gateway = () => request(GATEWAY_URL);
const checkout = () => request(CHECKOUT_URL);

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Payment processing is asynchronous (RabbitMQ queue + 500–2000ms artificial
 * latency in the fake gateway). Poll GET /payments/:orderId THROUGH the gateway
 * until the status leaves `pending`.
 */
async function pollPaymentStatus(
  token: string,
  orderId: string,
  { timeoutMs = 20000, intervalMs = 500 } = {},
): Promise<{ status: string; amount: number; orderId: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status?: string } = {};

  while (Date.now() < deadline) {
    const res = await gateway()
      .get(`/payments/${orderId}`)
      .set(bearer(token));

    if (res.status === 200) {
      last = res.body;
      if (res.body.status && res.body.status !== 'pending') {
        return res.body;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Payment for order ${orderId} did not settle within ${timeoutMs}ms (last status: ${last.status ?? 'unknown'})`,
  );
}

/**
 * A ordem é atualizada de forma assíncrona: o payments-service publica o
 * resultado do pagamento e o checkout-service consome esse evento para mudar
 * o status do pedido (approved -> paid, rejected -> failed). Poll GET
 * /orders/:orderId (direto no checkout-service) até sair de `pending`.
 */
async function pollOrderStatus(
  token: string,
  orderId: string,
  { timeoutMs = 20000, intervalMs = 500 } = {},
): Promise<{ status: string; total: number; id: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status?: string } = {};

  while (Date.now() < deadline) {
    const res = await checkout()
      .get(`/orders/${orderId}`)
      .set(bearer(token));

    if (res.status === 200) {
      last = res.body;
      if (res.body.status && res.body.status !== 'pending') {
        return res.body;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Order ${orderId} was not settled within ${timeoutMs}ms (last status: ${last.status ?? 'unknown'})`,
  );
}

async function registerAndLogin(
  role: 'seller' | 'buyer',
): Promise<{ token: string; email: string }> {
  const email = `${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
  const password = 'password123';

  await gateway()
    .post('/auth/register')
    .send({
      email,
      password,
      firstName: role === 'seller' ? 'Seller' : 'Buyer',
      lastName: 'E2E',
      role,
    })
    .expect((res) => {
      if (![200, 201].includes(res.status)) {
        throw new Error(`register ${role} failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

  const login = await gateway()
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return { token: login.body.token, email };
}

describe('Marketplace full flow (e2e, real services)', () => {
  let sellerToken: string;
  let buyerToken: string;
  let normalProductId: string;
  let ninetyNineProductId: string;

  // Normal price: not ending in .99, well under the R$10.000 approval limit.
  const NORMAL_PRICE = 49.9;
  // Price ending in .99 -> the fake payment gateway rejects it.
  const NINETY_NINE_PRICE = 99.99;

  it('registers and logs in a seller and a buyer via the gateway', async () => {
    ({ token: sellerToken } = await registerAndLogin('seller'));
    ({ token: buyerToken } = await registerAndLogin('buyer'));

    expect(sellerToken).toBeTruthy();
    expect(buyerToken).toBeTruthy();
  });

  it('lets the seller create two products via the gateway', async () => {
    const normal = await gateway()
      .post('/products')
      .set(bearer(sellerToken))
      .send({
        name: `E2E Normal ${Date.now()}`,
        description: 'Normal priced product',
        price: NORMAL_PRICE,
        stock: 100,
      })
      .expect(201);
    normalProductId = normal.body.id;

    const ninetyNine = await gateway()
      .post('/products')
      .set(bearer(sellerToken))
      .send({
        name: `E2E NinetyNine ${Date.now()}`,
        description: 'Price ending in .99',
        price: NINETY_NINE_PRICE,
        stock: 100,
      })
      .expect(201);
    ninetyNineProductId = ninetyNine.body.id;

    expect(normalProductId).toBeTruthy();
    expect(ninetyNineProductId).toBeTruthy();
  });

  it('lets the buyer see both products in the catalog via the gateway', async () => {
    const res = await gateway()
      .get('/products')
      .set(bearer(buyerToken))
      .expect(200);

    const ids: string[] = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(normalProductId);
    expect(ids).toContain(ninetyNineProductId);
  });

  it('Flow 1 (normal price): cart -> checkout -> order -> APPROVED payment', async () => {
    // Cart/checkout/order go DIRECT to checkout-service (gateway proxy gap).
    await checkout()
      .post('/cart/items')
      .set(bearer(buyerToken))
      .send({ productId: normalProductId, quantity: 1 })
      .expect(201);

    const cart = await checkout()
      .get('/cart')
      .set(bearer(buyerToken))
      .expect(200);
    expect(
      cart.body.items.some(
        (i: { productId: string }) => i.productId === normalProductId,
      ),
    ).toBe(true);

    const order = await checkout()
      .post('/cart/checkout')
      .set(bearer(buyerToken))
      .send({ paymentMethod: 'pix' })
      .expect(201);
    const orderId = order.body.id;
    expect(orderId).toBeTruthy();

    const fetched = await checkout()
      .get(`/orders/${orderId}`)
      .set(bearer(buyerToken))
      .expect(200);
    expect(fetched.body.id).toBe(orderId);
    expect(Number(fetched.body.total)).toBeCloseTo(NORMAL_PRICE, 2);

    // Payment lookup THROUGH the gateway, authenticated as the buyer.
    const payment = await pollPaymentStatus(buyerToken, orderId);
    expect(payment.status).toBe('approved');

    // The checkout-service consumes the payment result and settles the order.
    const settledOrder = await pollOrderStatus(buyerToken, orderId);
    expect(settledOrder.status).toBe('paid');
  }, 40000);

  it('Flow 2 (.99 price): cart -> checkout -> REJECTED payment', async () => {
    await checkout()
      .post('/cart/items')
      .set(bearer(buyerToken))
      .send({ productId: ninetyNineProductId, quantity: 1 })
      .expect(201);

    const cart = await checkout()
      .get('/cart')
      .set(bearer(buyerToken))
      .expect(200);
    expect(
      cart.body.items.some(
        (i: { productId: string }) => i.productId === ninetyNineProductId,
      ),
    ).toBe(true);

    const order = await checkout()
      .post('/cart/checkout')
      .set(bearer(buyerToken))
      .send({ paymentMethod: 'pix' })
      .expect(201);
    const orderId = order.body.id;
    expect(orderId).toBeTruthy();

    const payment = await pollPaymentStatus(buyerToken, orderId);
    expect(payment.status).toBe('rejected');

    // A rejected payment settles the order as `failed`.
    const settledOrder = await pollOrderStatus(buyerToken, orderId);
    expect(settledOrder.status).toBe('failed');
  }, 40000);
});
