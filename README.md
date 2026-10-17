# Marketplace MS

A marketplace built as a set of NestJS microservices. Sellers publish products, buyers fill a cart and check out, and payments are processed asynchronously through RabbitMQ. The platform is monitored with Prometheus and Grafana.

## Architecture

```
                        +------------------+
        client -------->|   api-gateway    | :3005
                        +---+----+----+----+
              +-------------+    |    +-------------+
              v                  v                  v
       +-------------+   +----------------+   +------------------+
       |users-service|   |products-service|   | payments-service | :3004
       |    :3000    |   |     :3001      |   |  (HTTP lookup)   |
       +------+------+   +-------+--------+   +--------^---------+
              |                  |                     |
           users_db          products_db           payments_db
                                 ^                     |
                                 | validates products  | consumes / publishes
                        +--------+---------+           |
                        | checkout-service | :3003     |
                        |  cart / orders   |<----------+
                        +--------+---------+     payment result
                                 | publishes order
                                 v
                          +-------------+
                          |  RabbitMQ   | :5672
                          +-------------+
```

| Service | Port | Responsibility |
| --- | --- | --- |
| [`api-gateway`](api-gateway) | 3005 | Entry point. Validates JWTs, applies rate limiting, circuit breaker, retry, timeout and fallback, and proxies requests to users, products and payments |
| [`users-service`](users-service) | 3000 | Registration, login (JWT) and profiles for buyers and sellers |
| [`products-service`](products-service) | 3001 | Product catalog, including listing by seller |
| [`checkout-service`](checkout-service) | 3003 | Cart, order checkout and order lookup |
| [`payments-service`](payments-service) | 3004 | Processes payments from the queue, exposes payment lookup by order and manages the dead-letter queue |
| [`messaging-service`](messaging-service) | 5672 / 15672 | Infrastructure: RabbitMQ |
| [`observability-stack`](observability-stack) | 9090 / 3010 | Infrastructure: Prometheus and Grafana |

### Purchase flow

1. The user registers and logs in (`/auth/register`, `/auth/login`) and receives a JWT.
2. Sellers publish products and buyers browse the catalog.
3. The buyer adds items to the cart and calls `POST /cart/checkout`, which creates the order as `pending`.
4. `checkout-service` publishes the order to a RabbitMQ queue.
5. `payments-service` consumes the queue, processes the payment and publishes the result.
6. `checkout-service` consumes the result and updates the order: `approved` becomes `paid`, `rejected` becomes `failed`.
7. The payment status can be queried at `GET /payments/:orderId`.

Note: the gateway does not yet expose the cart, checkout and order routes. Those are served directly by `checkout-service` on port 3003.

Payments go through a fake gateway with no real integration and a simulated latency of 500 to 2000 ms. Its rules are:

- Amounts above `10000` are rejected (`Limite excedido`).
- Amounts ending in `.99` are rejected (`Cartão recusado pela operadora`).
- Any other amount is approved.

## Tech stack

- **Language and framework:** TypeScript, [NestJS 11](https://nestjs.com) (Node.js 20+)
- **Database:** PostgreSQL 15, one database per service, accessed through TypeORM
- **Messaging:** RabbitMQ (`amqplib` / `amqp-connection-manager`), with a dead-letter queue for failed payments
- **Authentication:** JWT with Passport (`passport-jwt`), plus role and session guards in the gateway
- **Resilience and security (gateway):** circuit breaker, retry, timeout, fallback, `@nestjs/throttler` and `helmet`
- **Validation:** `class-validator` and `class-transformer`
- **API documentation:** Swagger / OpenAPI (`@nestjs/swagger`)
- **Health checks:** `@nestjs/terminus`
- **Observability:** metrics exposed with `prom-client`, scraped by Prometheus, with dashboards and alerts in Grafana
- **Testing:** Jest and Supertest
- **Local infrastructure:** Docker Compose

## Prerequisites

- [Node.js](https://nodejs.org) 20 or newer, and npm
- [Docker](https://www.docker.com) with Docker Compose
- Free ports: `3000`, `3001`, `3003`, `3004`, `3005`, `3010`, `5433`, `5435`, `5436`, `5437`, `5672`, `9090` and `15672`

## Running locally

The NestJS services run on the host. Docker is used only for the databases, RabbitMQ and the observability stack.

### 1. Clone the repository

```bash
git clone git@github.com:pauloborges-hub/marketplace-ms.git
cd marketplace-ms
```

### 2. Start the infrastructure

Each piece of infrastructure has its own `docker-compose.yml`:

```bash
# RabbitMQ
(cd messaging-service && docker compose up -d)

# One Postgres per service
(cd users-service    && docker compose up -d)   # users-db     -> localhost:5433
(cd payments-service && docker compose up -d)   # payments-db   -> localhost:5435
(cd products-service && docker compose up -d)   # products-db   -> localhost:5436
(cd checkout-service && docker compose up -d)   # checkout-db   -> localhost:5437
```

### 3. Configure environment variables

In each service, copy `.env.example` and fill in the values:

```bash
cp users-service/.env.example    users-service/.env
cp products-service/.env.example products-service/.env
cp checkout-service/.env.example checkout-service/.env
cp payments-service/.env.example payments-service/.env
cp api-gateway/.env.example      api-gateway/.env
```

The values below work with the `docker-compose.yml` files in this repository. Variables left empty fall back to the defaults in the code (local ports, database and RabbitMQ).

| Variable | Suggested value | Used by |
| --- | --- | --- |
| `PORT` | the service port (see the table above) | all |
| `NODE_ENV` | `development` | users, products, checkout, payments |
| `DB_HOST` | `localhost` | users, products, checkout, payments |
| `DB_PORT` | `5433` (users), `5436` (products), `5437` (checkout), `5435` (payments) | users, products, checkout, payments |
| `DB_USERNAME` / `DB_PASSWORD` | `postgres` / `postgres` | users, products, checkout, payments |
| `DB_DATABASE` | `users_db`, `products_db`, `checkout_db`, `payments_db` | each service, its own |
| `JWT_SECRET` | **the same value in every service** | users, products, checkout, api-gateway |
| `JWT_EXPIRES_IN` | any value (currently not read by the code; tokens issued by `users-service` expire after 24h) | checkout, payments |
| `USERS_SERVICE_URL` | `http://localhost:3000` | api-gateway |
| `PRODUCTS_SERVICE_URL` | `http://localhost:3001` | api-gateway, checkout |
| `CHECKOUT_SERVICE_URL` | `http://localhost:3003` | api-gateway |
| `PAYMENTS_SERVICE_URL` | `http://localhost:3004` | api-gateway |
| `RABBITMQ_URL` | `amqp://admin:admin@localhost:5672` | checkout, payments |
| `CORS_ORIGIN` | front-end origin, if any | api-gateway |

`JWT_SECRET` must be identical in every service, otherwise a token issued by `users-service` is rejected by the others. The services will not start without it.

Outside production (`NODE_ENV` other than `production`), TypeORM runs with `synchronize` and creates the tables automatically. There are no migrations.

### 4. Install dependencies and start the services

Each service is an independent npm project. Run the following in one terminal per service:

```bash
cd users-service     # then products-service, checkout-service, payments-service, api-gateway
npm install
npm run start:dev
```

### 5. Verify everything is up

```bash
curl http://localhost:3005/health            # api-gateway
curl http://localhost:3005/health/services   # status of the downstream services
```

Swagger documentation, where available, is served at `http://localhost:<port>/api` (gateway, users, products and checkout).

### 6. Observability (optional)

```bash
(cd observability-stack && docker compose up -d)
```

| Tool | URL | Login |
| --- | --- | --- |
| Prometheus | http://localhost:9090 | none |
| Grafana | http://localhost:3010 | `admin` / `admin` |
| RabbitMQ Management | http://localhost:15672 | `admin` / `admin` |

Grafana starts with the Prometheus datasource and the **Marketplace Overview** and **Service Details** dashboards already provisioned. Prometheus scrapes the `/metrics` endpoint of each service. See the [observability stack README](observability-stack/README.md) for the configured alerts.

The credentials above are for local development only. Change them in production.

## Testing

Inside each service:

```bash
npm run test        # unit tests
npm run test:e2e    # e2e tests
npm run test:cov    # coverage
```

The unit and e2e suites run offline, without Postgres, RabbitMQ or downstream services.

The full marketplace flow runs against real services. Start all the infrastructure and the five services, then run:

```bash
cd api-gateway && npm run test:e2e:flow
```

## Repository layout

```
marketplace-ms/
|-- api-gateway/           # Gateway (NestJS)
|-- users-service/         # Users and authentication (NestJS + Postgres)
|-- products-service/      # Catalog (NestJS + Postgres)
|-- checkout-service/      # Cart and orders (NestJS + Postgres + RabbitMQ)
|-- payments-service/      # Payments (NestJS + Postgres + RabbitMQ)
|-- messaging-service/     # RabbitMQ Docker Compose
|-- observability-stack/   # Prometheus + Grafana (dashboards and alerts)
`-- docs/specs/            # Cross-cutting feature specs
```

Each service also has its own `docs/specs/` folder with the specifications of the features it implements.
