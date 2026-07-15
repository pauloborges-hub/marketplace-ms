# SPEC: Finalização do pedido (checkout) no `checkout-service`

> **Objetivo:** Permitir que um usuário autenticado finalize seu carrinho ativo, transformando-o em
> um pedido (`Order`) com um método de pagamento escolhido, publicando esse pedido na fila de
> pagamentos para processamento assíncrono pelo `payments-service`, e permitir que o usuário consulte
> os pedidos já criados.
>
> **Escopo desta spec:** endpoint `POST /cart/checkout` (finalização do carrinho ativo, criação de
> `Order`, transição do carrinho para `completed`, publicação em fila); endpoints `GET /orders` e
> `GET /orders/:id` (consulta de pedidos do usuário autenticado); `OrdersModule` com o service e
> controller responsáveis por essa lógica; DTOs de request/response envolvidos.
> **Fora de escopo:** processamento de pagamento em si — é responsabilidade exclusiva do
> `payments-service`, que consome a fila de forma assíncrona e (em fluxo futuro, fora desta spec)
> atualiza o status do pedido. Cancelamento de pedido. Verificação ou reserva de estoque no momento do
> checkout. Qualquer endpoint de consulta ou gestão de pedidos por terceiros (ex.: admin ver pedidos de
> outro usuário, seller ver pedidos que contêm seus produtos). Reprocessamento ou repetição de
> publicação em fila para um pedido já criado. Qualquer lógica de retry, dead-letter ou confirmação de
> entrega da mensagem além do que `PaymentQueueService`/`RabbitmqService` já oferecem.

---

## 1. Contexto

O `checkout-service` (porta 3003) já possui, graças às specs anteriores:

- Entidades TypeORM `Cart` (com `items` eager, `total` decimal e `status`: `active` | `completed` |
  `abandoned`) e `CartItem` (`productId`, `productName`, `price`, `quantity`, `subtotal`), com
  `CartService`/`CartController` funcionais expondo `POST /cart/items`, `GET /cart` e
  `DELETE /cart/items/:itemId` — todos protegidos e escopados ao usuário autenticado (`req.user.id`).
- Entidade TypeORM `Order` (`src/orders/entities/order.entity.ts`) já definida, com `id`, `userId`,
  `cartId`, `total` (decimal), `status` (enum `OrderStatus`: `pending` | `paid` | `failed` |
  `cancelled`, default `pending`), `paymentMethod` (string) e timestamps — porém `OrdersModule`
  atualmente apenas registra essa entidade via `TypeOrmModule.forFeature`, sem controller, service ou
  DTO algum.
- `AuthModule` com `JwtStrategy`, `JwtAuthGuard` global (via `APP_GUARD`) e decorator `@Public()` —
  toda rota nova criada nesta spec é protegida por padrão.
- `req.user` disponível em qualquer rota protegida, tipado por `AuthenticatedUser` (`id`, `email`,
  `role`).
- `EventsModule`, exportando `PaymentQueueService`, que expõe `publishPaymentOrder`, publicando no
  exchange `payments` com routing key `payment.order`. A mensagem publicada segue a interface
  `PaymentOrderMessage` (`src/events/payment-queue.interface.ts`): `orderId`, `userId`, `amount`,
  `items` (array de `{ productId, quantity, price }`), `paymentMethod`, e opcionalmente
  `description`/`createdAt` (o próprio `PaymentQueueService` preenche `createdAt` e `metadata` se não
  fornecidos).
- O `payments-service` consome mensagens da fila `payment_queue` (ligada ao exchange/routing key
  acima) e processa o pagamento de forma assíncrona, em processo totalmente desacoplado desta spec.

Esta spec cobre a segunda fatia de negócio do `checkout-service`: transformar um carrinho ativo em um
pedido, disparar o processamento de pagamento de forma assíncrona, e permitir a consulta desses
pedidos pelo próprio usuário.

---

## 2. Stack e padrões

- **Framework:** NestJS 11, seguindo os mesmos padrões já estabelecidos no serviço (módulos por
  domínio, DTOs com `class-validator`, guard global de autenticação).
- **Tipagem:** todas as funções, métodos, variáveis e parâmetros criados ou alterados nesta spec devem
  ser explicitamente tipados — sem uso de `any` implícito ou inferência ambígua nas assinaturas
  públicas (services, controllers, DTOs, interfaces).
- **Persistência:** TypeORM, reaproveitando as entidades `Order`, `Cart` e `CartItem` já existentes —
  nenhuma alteração de schema é necessária para esta spec.
- **Publicação em fila:** exclusivamente através do `PaymentQueueService` já existente (método
  `publishPaymentOrder`) — nenhum ponto do código desta spec deve montar mensagens manualmente para o
  `RabbitmqService` ou acessar o exchange/routing key diretamente.
- **Validação de entrada:** DTOs com `class-validator`, seguindo o padrão já usado no `CartModule`
  (`AddCartItemDto`).
- **Autorização:** os três endpoints desta spec são protegidos pelo guard global já existente —
  nenhum deles deve ser marcado como `@Public()`.
- **Escopo por usuário:** toda operação usa exclusivamente o `id` do usuário autenticado
  (`req.user.id`) para localizar o carrinho e os pedidos — nenhum endpoint recebe `userId` como
  parâmetro de entrada.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário
  para esta spec.

---

## 3. Requisitos funcionais

### RF1 — `POST /cart/checkout` (finalizar carrinho)
- Endpoint protegido; requer usuário autenticado.
- Recebe no corpo da requisição:
  - `paymentMethod`: obrigatório, restrito a um dos valores `credit_card`, `debit_card`, `pix` ou
    `boleto`.
- Fluxo esperado:
  1. Valida o formato do corpo da requisição (`paymentMethod` presente e é um dos quatro valores
     aceitos). Corpo inválido é rejeitado antes de qualquer consulta ao carrinho, criação de pedido ou
     publicação em fila.
  2. Localiza o carrinho ativo (`status: active`) do usuário autenticado (`req.user.id`).
  3. Se o usuário não possuir nenhum carrinho ativo, ou se o carrinho ativo não possuir nenhum item, a
     requisição é rejeitada — carrinho vazio ou inexistente não pode ser finalizado.
  4. Cria uma `Order` com: `userId` do usuário autenticado, `cartId` do carrinho localizado, `total`
     igual ao `total` atual do carrinho, `paymentMethod` recebido no corpo, e `status` inicial
     `pending`.
  5. Altera o `status` do carrinho de `active` para `completed`.
  6. Persiste a `Order` criada e a alteração de status do carrinho.
  7. Publica, através do `PaymentQueueService`, uma `PaymentOrderMessage` correspondente ao pedido
     recém-criado: `orderId` (id da `Order` criada), `userId`, `amount` (igual ao `total` da `Order`),
     `items` (um item por `CartItem` do carrinho, cada um com `productId`, `quantity` e `price`
     — o `price` gravado no item, não um preço novo) e `paymentMethod`.
  8. Retorna a `Order` criada, com status HTTP **201**.
- Caso a publicação na fila de pagamentos falhe (erro do `PaymentQueueService`/`RabbitmqService`), a
  falha deve ser propagada como erro da requisição — a spec não define nenhum mecanismo de
  compensação, reversão do pedido/carrinho ou nova tentativa automática além do que já existe no
  `PaymentQueueService`.
- Este endpoint não processa pagamento algum, não verifica nem reserva estoque, e não permite escolher
  itens parciais do carrinho — finaliza sempre o carrinho ativo por completo.

### RF2 — `GET /orders` (listar pedidos do usuário)
- Endpoint protegido; requer usuário autenticado.
- Retorna todos os pedidos (`Order`) pertencentes ao usuário autenticado (`req.user.id`) — nunca
  pedidos de outro usuário.
- Os pedidos são ordenados por data de criação, do mais recente para o mais antigo.
- Se o usuário autenticado não possuir nenhum pedido, o endpoint retorna uma lista vazia com sucesso.

### RF3 — `GET /orders/:id` (detalhe do pedido)
- Endpoint protegido; requer usuário autenticado.
- Recebe `id` (UUID) como parâmetro de rota, identificando a `Order` a ser consultada.
- Fluxo esperado:
  1. Valida o formato de `id` (UUID válido).
  2. Localiza o pedido pelo `id`. Se não existir nenhum pedido com esse `id`, a requisição é rejeitada
     com **404**.
  3. Verifica se o pedido pertence ao usuário autenticado (`req.user.id`). Se o pedido existir mas
     pertencer a outro usuário, a requisição é rejeitada da mesma forma que um pedido inexistente
     (**404**, sem revelar a um usuário que o `id` pertence a outra pessoa).
  4. Retorna o pedido encontrado.

### RF4 — DTOs de request
- Deve existir um DTO para o corpo de `POST /cart/checkout`, validando `paymentMethod` como
  obrigatório e restrito aos quatro valores aceitos (`credit_card`, `debit_card`, `pix`, `boleto`),
  rejeitando a requisição antes de qualquer acesso ao carrinho ou ao banco quando o valor for
  inválido ou ausente.
- O `id` de `GET /orders/:id` deve ser validado como UUID diretamente no parâmetro de rota.

### RF5 — `OrdersModule`
- `OrdersModule` deve importar `CartModule` (para obter acesso ao carrinho ativo do usuário no
  fluxo de checkout) e `EventsModule` (para obter acesso ao `PaymentQueueService`), além de manter o
  registro já existente da entidade `Order` via `TypeOrmModule.forFeature`.
- O endpoint `POST /cart/checkout`, apesar de fazer parte da rota `/cart`, deve ter sua lógica de
  negócio (validação do carrinho, criação da `Order`, publicação em fila) implementada dentro do
  domínio de pedidos (`OrdersModule`/`OrdersService`), e não duplicada ou misturada na lógica já
  existente do `CartService`.

---

## 4. Regras de negócio

- **RN1** — Somente um carrinho com `status: active` e ao menos um item pode ser finalizado; carrinho
  inexistente ou sem itens não gera pedido algum.
- **RN2** — Ao finalizar um carrinho, seu `status` passa definitivamente para `completed` — um
  carrinho finalizado nunca volta a ser `active` nem pode ser finalizado novamente.
- **RN3** — O `total` do pedido criado é sempre igual ao `total` do carrinho no momento da
  finalização — nunca recalculado a partir de preços atuais de produto.
- **RN4** — Todo pedido criado nasce com `status: pending` — a transição para `paid`, `failed` ou
  `cancelled` é responsabilidade exclusiva de um fluxo assíncrono fora do escopo desta spec (resultado
  do processamento no `payments-service`).
- **RN5** — Um usuário só pode finalizar o próprio carrinho, e só pode consultar (listar ou ver
  detalhe) os próprios pedidos — jamais carrinho ou pedidos de outro usuário, identificado pelo `id`
  extraído do token JWT (`req.user.id`), nunca por parâmetro de entrada.
- **RN6** — A mensagem publicada na fila de pagamentos reflete fielmente os itens do carrinho no
  momento da finalização (`productId`, `quantity`, `price` gravados em cada `CartItem`) — nunca dados
  buscados novamente de outra fonte.
- **RN7** — Tanto usuários com `role: seller` quanto `role: buyer` podem finalizar seu carrinho e
  consultar seus próprios pedidos — nenhum dos três endpoints desta spec restringe acesso por `role`.

---

## 5. Respostas esperadas

### `POST /cart/checkout`
- **201 Created** — carrinho ativo existente e com ao menos um item, `paymentMethod` válido: cria a
  `Order`, atualiza o carrinho para `completed`, publica a mensagem de pagamento, e retorna a `Order`
  criada.
- **400 Bad Request** — `paymentMethod` ausente ou fora dos valores aceitos.
- **400/404/422 (erro de negócio)** — usuário sem carrinho ativo, ou carrinho ativo sem nenhum item.
- **401 Unauthorized** — requisição sem token válido (comportamento já garantido pelo guard global).

### `GET /orders`
- **200 OK** — sempre, para um usuário autenticado: retorna a lista de pedidos do usuário (vazia, se
  não houver nenhum), ordenada da mais recente para a mais antiga.
- **401 Unauthorized** — requisição sem token válido.

### `GET /orders/:id`
- **200 OK** — pedido existente e pertencente ao usuário autenticado: retorna o pedido.
- **400 Bad Request** — `id` não é um UUID válido.
- **404 Not Found** — nenhum pedido com esse `id` existe, ou existe mas pertence a outro usuário.
- **401 Unauthorized** — requisição sem token válido.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — `POST /cart/checkout`, com um carrinho ativo contendo ao menos um item e
  `paymentMethod` válido, cria uma `Order` com `userId` e `cartId` corretos, `total` igual ao `total`
  do carrinho, `paymentMethod` recebido e `status: pending`.
- [ ] **CA2** — Após um `POST /cart/checkout` bem-sucedido, o carrinho utilizado passa a ter
  `status: completed` e deixa de ser retornado por `GET /cart` como carrinho ativo (um novo carrinho
  vazio passa a ser considerado o ativo).
- [ ] **CA3** — Após um `POST /cart/checkout` bem-sucedido, o `PaymentQueueService.publishPaymentOrder`
  é chamado exatamente uma vez, com uma `PaymentOrderMessage` cujo `orderId` corresponde à `Order`
  criada, `amount` igual ao `total` da `Order`, `userId` igual ao usuário autenticado, `paymentMethod`
  igual ao recebido, e `items` refletindo exatamente os itens do carrinho (`productId`, `quantity`,
  `price` de cada `CartItem`).
- [ ] **CA4** — `POST /cart/checkout` retorna **201** com o corpo da `Order` criada.
- [ ] **CA5** — `POST /cart/checkout` com `paymentMethod` ausente ou com valor fora de `credit_card`,
  `debit_card`, `pix`, `boleto` retorna **400**, e não cria `Order`, não altera o carrinho, e não
  publica mensagem alguma na fila.
- [ ] **CA6** — `POST /cart/checkout` para um usuário sem nenhum carrinho `active` é rejeitado, e não
  cria `Order`, não publica mensagem alguma na fila.
- [ ] **CA7** — `POST /cart/checkout` para um usuário cujo carrinho `active` não possui nenhum item é
  rejeitado, e não cria `Order`, não altera o carrinho, e não publica mensagem alguma na fila.
- [ ] **CA8** — `GET /orders`, para um usuário autenticado com pedidos previamente criados, retorna
  todos os seus pedidos ordenados do mais recente para o mais antigo.
- [ ] **CA9** — `GET /orders`, para um usuário autenticado sem nenhum pedido, retorna uma lista vazia
  com sucesso (não um erro).
- [ ] **CA10** — `GET /orders` de um usuário nunca retorna pedidos pertencentes a outro usuário.
- [ ] **CA11** — `GET /orders/:id` de um pedido existente e pertencente ao usuário autenticado retorna
  esse pedido com sucesso.
- [ ] **CA12** — `GET /orders/:id` com um `id` que não corresponde a nenhum pedido retorna **404**.
- [ ] **CA13** — `GET /orders/:id` com um `id` que existe mas pertence a outro usuário retorna **404**
  (não deve revelar a existência do pedido a um usuário sem permissão sobre ele).
- [ ] **CA14** — `GET /orders/:id` com um `id` que não é um UUID válido retorna **400**.
- [ ] **CA15** — Um usuário com `role: seller` e um usuário com `role: buyer` conseguem, cada um,
  finalizar seu próprio carrinho e consultar seus próprios pedidos através destes endpoints, sem
  distinção de comportamento baseada em `role`.
- [ ] **CA16** — Todos os três endpoints (`POST /cart/checkout`, `GET /orders`, `GET /orders/:id`)
  retornam **401** quando chamados sem um token JWT válido.
- [ ] **CA17** — Todas as funções, métodos, parâmetros e variáveis criados ou alterados nesta spec
  possuem tipagem explícita (sem `any` implícito nas assinaturas públicas).
- [ ] **CA18** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Depende diretamente da spec anterior (`02 - gerenciamento-do-carrinho.md`): `CartModule` funcional com
carrinho ativo por usuário e itens com `price`/`subtotal` consistentes. Depende também da entidade
`Order` já modelada (spec `01 - domain-entities-and-jwt-authentication.md`) e do `EventsModule`
(`PaymentQueueService`/`RabbitmqService`) já existente e configurado para publicar no exchange
`payments` / routing key `payment.order`.

Fora do escopo desta spec, ficam para specs futuras: atualização do `status` do pedido (`paid`,
`failed`, `cancelled`) a partir do processamento assíncrono do `payments-service`; cancelamento de
pedido; e verificação/reserva de estoque no fluxo de checkout.
