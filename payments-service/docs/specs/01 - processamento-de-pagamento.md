# SPEC: Processamento de pagamento no `payments-service`

> **Objetivo:** Completar o fluxo assíncrono de pagamento do `payments-service`, persistindo cada
> pedido recebido da fila como um `Payment`, processando-o através de um gateway de pagamento
> simulado (fake), e expondo um endpoint para consulta do status desse pagamento por `orderId`.
>
> **Escopo desta spec:** entidade `Payment`; `FakePaymentGatewayService` (simulação determinística de
> aprovação/rejeição); `PaymentsService` (`processPayment`, `findByOrderId`); conclusão do TODO em
> `PaymentConsumerService` (chamada real ao processamento, no lugar do log atual); endpoint
> `GET /payments/:orderId`; endpoint `GET /health`; `PaymentsModule` que reúne essas peças.
> **Fora de escopo:** qualquer integração com gateway de pagamento real (Stripe, PagSeguro, etc.);
> qualquer webhook, evento ou publicação em fila para notificar o `checkout-service` sobre o
> resultado do pagamento (isso é responsabilidade de uma spec futura); alteração dos endpoints já
> existentes de DLQ (`/dlq/*`) e de métricas do consumer (`/metrics`, `/metrics/health`,
> `/metrics/summary`, `/metrics/reset`); autenticação/autorização de qualquer endpoint (o
> `payments-service` não possui `AuthModule` e esta spec não introduz um); alteração do formato de
> `PaymentOrderMessage` ou da lógica de validação (`validateMessage`) já existente no consumer.

---

## 1. Contexto

O `payments-service` (porta 3004) já possui:

- NestJS 11, TypeORM configurado contra PostgreSQL (porta 5435, banco `payments_db`,
  `synchronize` ligado fora de produção), com entidades carregadas automaticamente via glob
  (`src/**/*.entity{.ts,js}`) — nenhuma entidade de domínio existe ainda.
- `EventsModule`, com `RabbitmqService` (conexão, publish e `subscribeToQueue` já implementando
  retry com backoff e dead-letter queue) e `PaymentQueueService` (consumo da fila `payment_queue`,
  ligada ao exchange `payments` / routing key `payment.order`).
- `PaymentConsumerService`, que já consome a fila, valida a mensagem recebida (`validateMessage`,
  garantindo `orderId`, `userId`, `amount > 0`, `paymentMethod` e `items` não vazio) e mantém métricas
  de processamento (`ConsumerMetrics`) — mas o processamento em si é um `TODO`: a mensagem válida
  apenas é logada, sem nenhum efeito real.
- `DlqController`/`DlqService`, expondo `GET /dlq/stats`, `GET /dlq/messages`,
  `POST /dlq/reprocess/:orderId`, `POST /dlq/reprocess-all` e `DELETE /dlq/message/:orderId` /
  `DELETE /dlq/purge` — endpoints já funcionais, que reenviam mensagens da DLQ de volta para a fila
  principal, onde o `PaymentConsumerService` as processa novamente.
- `MetricsController`, expondo `GET /metrics`, `GET /metrics/health` e `GET /metrics/summary` /
  `POST /metrics/reset` — todos derivados das métricas internas do `PaymentConsumerService`, não do
  processamento de pagamento em si.
- A interface `PaymentOrderMessage` (`src/events/payment-queue.interface.ts`): `orderId`, `userId`,
  `amount`, `items` (array de `{ productId, quantity, price }`), `paymentMethod`, e opcionalmente
  `description`/`createdAt`/`metadata`.
- O `checkout-service`, que publica exatamente essa mensagem no exchange/routing key acima ao
  finalizar um pedido (`POST /cart/checkout`), de forma totalmente desacoplada — o `payments-service`
  nunca é chamado de forma síncrona pelo `checkout-service`.
- Uma peculiaridade importante do mecanismo de entrega: o `RabbitmqService.subscribeToQueue` faz
  `await callback(message)` e só dá **ACK** se essa promise resolver; se ela rejeitar, a mensagem é
  reenviada para a fila de retry (até o limite configurado) e, esgotadas as tentativas, vai para a
  DLQ. Hoje, `PaymentConsumerService.processPaymentOrder` não é assíncrono e nunca rejeita além de
  erros inesperados — esta spec depende de preservar esse contrato (rejeitar a promise = tentar de
  novo; resolver = mensagem tratada) ao plugar o processamento real.

Esta é a primeira spec de domínio do `payments-service`: cobre a fatia que transforma uma mensagem de
pedido recebida da fila em um registro de pagamento persistido, processado por um gateway simulado, e
consultável via API.

---

## 2. Stack e padrões

- **Framework:** NestJS 11, seguindo os mesmos padrões já estabelecidos no serviço (módulos por
  domínio, `Injectable`/`Logger` nos services, `Controller` fino delegando a services).
- **Tipagem:** todas as funções, métodos, variáveis e parâmetros criados ou alterados nesta spec devem
  ser explicitamente tipados — sem uso de `any` implícito ou inferência ambígua nas assinaturas
  públicas (entidade, services, controller, interfaces de retorno do gateway fake).
- **Persistência:** TypeORM, com uma nova entidade `Payment` registrada via
  `TypeOrmModule.forFeature` no novo `PaymentsModule` — nenhuma alteração é necessária na
  configuração global de banco (`database.config.ts`), já preparada para descobrir novas entidades
  automaticamente.
- **Consumo de fila:** exclusivamente através do `PaymentConsumerService`/`PaymentQueueService`/
  `RabbitmqService` já existentes — esta spec não cria nenhum novo consumer, exchange, routing key ou
  fila.
- **Gateway de pagamento:** inteiramente simulado (fake, in-process) — nenhuma chamada de rede, HTTP
  ou SDK externo é feita. As variáveis `PAYMENT_GATEWAY_URL`/`PAYMENT_GATEWAY_API_KEY` já presentes em
  `.env.example` não são utilizadas por esta spec.
- **Autenticação:** o `payments-service` não possui guard de autenticação; o endpoint de consulta
  desta spec permanece, como os demais endpoints do serviço, sem proteção.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário
  para esta spec.

---

## 3. Requisitos funcionais

### RF1 — Entidade `Payment`
- Nova entidade TypeORM, representando um pagamento associado a um pedido do `checkout-service`, com
  os seguintes campos:
  - `id`: UUID, chave primária gerada automaticamente.
  - `orderId`: UUID, identifica o pedido de origem (vindo da `PaymentOrderMessage`).
  - `userId`: UUID, identifica o usuário dono do pedido.
  - `amount`: decimal com precisão 10 e escala 2, valor do pagamento.
  - `status`: enum com os valores `pending`, `approved` e `rejected`, com valor padrão `pending`.
  - `paymentMethod`: string, tamanho máximo 50.
  - `transactionId`: string, tamanho máximo 255, opcional (nulo até o gateway responder).
  - `rejectionReason`: string, tamanho máximo 255, opcional (nulo a menos que o pagamento seja
    rejeitado).
  - `processedAt`: timestamp, opcional (nulo enquanto o pagamento estiver `pending`).
  - `createdAt`/`updatedAt`: timestamps de auditoria, geridos automaticamente.
- Deve existir exatamente um `Payment` por `orderId` — nenhum pedido pode gerar mais de um registro de
  pagamento (ver RN5).

### RF2 — `FakePaymentGatewayService`
- Novo service, isolado do `PaymentsService`, responsável por simular o comportamento de um gateway de
  pagamento externo.
- Recebe o valor (`amount`) do pagamento a ser processado.
- Simula uma latência de rede antes de responder, entre 500ms e 2 segundos.
- Aplica regras determinísticas (mesma entrada sempre produz a mesma decisão, apenas a latência varia)
  para decidir entre aprovação e rejeição — ver RN1/RN2/RN3 para as regras e sua precedência.
- Retorna um resultado contendo: se o pagamento foi aprovado ou não, um identificador de transação
  (gerado pelo próprio fake gateway, simulando o identificador que um gateway real retornaria), e,
  quando rejeitado, o motivo da rejeição.
- Este service não conhece nem depende da entidade `Payment` nem de qualquer estado de persistência —
  sua única responsabilidade é simular a resposta do gateway a partir do valor informado.

### RF3 — `PaymentsService.processPayment`
- Recebe a mensagem `PaymentOrderMessage` (já validada pelo consumer) e conduz todo o ciclo de
  processamento de um pagamento:
  1. Verifica se já existe um `Payment` para o `orderId` recebido (ver RN5 — idempotência).
  2. Cria (ou reaproveita, conforme RN5) o registro `Payment` com status `pending`, contendo
     `orderId`, `userId`, `amount` e `paymentMethod` da mensagem.
  3. Persiste esse registro antes de acionar o gateway fake.
  4. Aciona o `FakePaymentGatewayService` com o valor do pagamento.
  5. Atualiza o mesmo registro com o resultado: `status` (`approved` ou `rejected`),
     `transactionId`, `rejectionReason` (quando aplicável) e `processedAt`.
  6. Persiste a atualização.
- Não retorna nenhum dado de que o `PaymentConsumerService` dependa além de indicar sucesso (para
  permitir o ACK da mensagem) ou lançar uma exceção (para permitir o NACK/retry) — ver RN6 para o que
  distingue as duas situações.

### RF4 — `PaymentsService.findByOrderId`
- Recebe um `orderId` e retorna o `Payment` correspondente.
- Se nenhum `Payment` existir para o `orderId` informado, o método sinaliza uma condição de "não
  encontrado" que o controller (RF5) traduz para **404**.

### RF5 — `GET /payments/:orderId`
- Novo endpoint, exposto por um novo `PaymentsController`.
- Recebe `orderId` como parâmetro de rota.
- Consulta o pagamento através de `PaymentsService.findByOrderId`.
- Retorna o pagamento encontrado (incluindo `status`, `amount`, `paymentMethod`, `transactionId`,
  `rejectionReason` e `processedAt`) ou **404** se nenhum pagamento existir para esse `orderId`.

### RF6 — Completar `PaymentConsumerService`
- O `TODO` existente em `processPaymentOrder` (`// TODO: Processar pagamento usando PaymentsService`)
  é substituído pela chamada real a `PaymentsService.processPayment`, passando a mensagem já validada.
- O restante do fluxo já existente (log de recebimento, validação via `validateMessage`, atualização de
  métricas via `updateMetrics`, incremento de retries) é preservado sem alteração de comportamento.
- O contrato de ACK/NACK descrito no Contexto é respeitado: uma falha técnica durante
  `processPayment` deve continuar propagando erro para fora de `processPaymentOrder`, para que o
  `RabbitmqService` faça o retry/DLQ; um processamento concluído (independentemente do pagamento ter
  sido aprovado ou rejeitado pelo gateway fake) conta como sucesso.

### RF7 — Health check (`GET /health`)
- Novo endpoint simples, na raiz do serviço (`/health`, distinto de `/metrics/health`, que reflete a
  saúde do consumer e já existe).
- Verifica a disponibilidade básica do serviço (aplicação no ar e conexão com o banco de dados
  operante).
- Não depende de nenhuma métrica do `PaymentConsumerService` nem da fila/RabbitMQ — é um health check
  do serviço HTTP e da camada de persistência, não do pipeline de mensageria.

### RF8 — `PaymentsModule`
- Novo módulo, reunindo: registro da entidade `Payment` (`TypeOrmModule.forFeature`),
  `FakePaymentGatewayService`, `PaymentsService`, `PaymentsController` e o endpoint de health check.
- Deve exportar `PaymentsService`, para que `EventsModule` (ou o módulo que contiver
  `PaymentConsumerService`) possa injetá-lo sem duplicar lógica.
- A dependência entre `EventsModule` e `PaymentsModule` é resolvida de forma que não haja import
  circular — `PaymentConsumerService` passa a depender de `PaymentsService`.

---

## 4. Regras de negócio

- **RN1** — Todo pagamento cujo `amount` seja maior que 10000 é rejeitado pelo gateway fake, com o
  motivo "Limite excedido".
- **RN2** — Todo pagamento cujo valor termine em `.99` (ex.: 149.99, 30.99) é rejeitado pelo gateway
  fake, com o motivo "Cartão recusado pela operadora" — a verificação deve ser feita de forma
  consistente com os dois casos decimais armazenados, sem incorrer em erros de precisão de ponto
  flutuante.
- **RN3** — Quando um valor se enquadra em mais de uma regra de rejeição ao mesmo tempo (ex.:
  10000.99), a regra de limite excedido (RN1) tem precedência sobre a regra de valor terminado em
  `.99` (RN2) — o motivo retornado é sempre "Limite excedido" nesse caso.
- **RN4** — Qualquer valor que não se enquadre em RN1 nem RN2 é aprovado.
- **RN5 (idempotência)** — Um mesmo `orderId` nunca gera mais de um registro de `Payment`:
  - Se já existir um `Payment` em status final (`approved` ou `rejected`) para o `orderId` recebido, a
    mensagem é considerada já processada — nenhum novo registro é criado, o gateway fake não é
    chamado novamente, e o processamento é tratado como concluído com sucesso (permitindo o ACK).
  - Se já existir um `Payment` em status `pending` para o `orderId` (por exemplo, uma tentativa
    anterior criou o registro mas falhou antes de o gateway responder), o processamento retoma esse
    mesmo registro — aciona o gateway fake e atualiza esse `Payment` existente, em vez de criar um
    novo.
- **RN6 (falha técnica vs. rejeição de negócio)** — Uma rejeição decidida pelo gateway fake (RN1/RN2)
  é um resultado de negócio válido, não um erro: o `Payment` é salvo com status `rejected` e o
  processamento é considerado concluído com sucesso (ACK), sem acionar retry ou DLQ. Somente falhas
  técnicas (ex.: erro ao persistir no banco, exceção inesperada) devem propagar como erro e acionar o
  mecanismo de retry/DLQ já existente no `RabbitmqService`.
- **RN7** — O `transactionId` é sempre gerado pelo `FakePaymentGatewayService` para toda tentativa de
  pagamento processada, independentemente de o resultado ser aprovação ou rejeição.
- **RN8** — `rejectionReason` é preenchido se, e somente se, o pagamento for rejeitado; permanece nulo
  para pagamentos aprovados ou ainda `pending`.
- **RN9** — `processedAt` é preenchido no momento em que o gateway fake responde (aprovado ou
  rejeitado); permanece nulo enquanto o `Payment` estiver `pending`.
- **RN10** — A latência simulada do gateway fake (500ms–2s) é a única forma de "processamento
  assíncrono" desta spec — nenhuma fila, worker ou job adicional é introduzido para isso.

---

## 5. Respostas esperadas

### `GET /payments/:orderId`
- **200 OK** — pagamento existente para o `orderId` informado: retorna o `Payment` (status, amount,
  paymentMethod, transactionId, rejectionReason, processedAt, createdAt/updatedAt).
- **404 Not Found** — nenhum pagamento existe para o `orderId` informado.

### `GET /health`
- **200 OK** — aplicação no ar e conexão com o banco de dados operante.
- **503 Service Unavailable** (ou equivalente) — conexão com o banco de dados indisponível.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Ao receber uma `PaymentOrderMessage` válida sem `Payment` prévio para o `orderId`, é
  criado um `Payment` com `status: pending`, `orderId`, `userId`, `amount` e `paymentMethod`
  correspondentes à mensagem, antes de o gateway fake ser acionado.
- [ ] **CA2** — Após o gateway fake responder, o `Payment` criado em CA1 é atualizado com `status`
  (`approved` ou `rejected`), `transactionId` e `processedAt` preenchidos.
- [ ] **CA3** — Um pagamento com `amount` maior que 10000 é sempre rejeitado, com `rejectionReason`
  igual a "Limite excedido".
- [ ] **CA4** — Um pagamento com `amount` terminado em `.99` (e não maior que 10000) é sempre
  rejeitado, com `rejectionReason` igual a "Cartão recusado pela operadora".
- [ ] **CA5** — Um pagamento com `amount` que não se enquadra em CA3 nem CA4 é sempre aprovado, com
  `rejectionReason` nulo.
- [ ] **CA6** — Um pagamento cujo `amount` se enquadre simultaneamente nas regras de CA3 e CA4 (ex.:
  10000.99) é rejeitado com `rejectionReason` igual a "Limite excedido".
- [ ] **CA7** — Duas chamadas de processamento para o mesmo `orderId`, quando a primeira já resultou em
  um `Payment` com status final (`approved`/`rejected`), não geram um segundo registro de `Payment` —
  apenas um `Payment` existe para esse `orderId`, e a segunda chamada não aciona o gateway fake
  novamente.
- [ ] **CA8** — Uma falha técnica durante o processamento (ex.: erro de persistência) propaga uma
  exceção a partir do processamento do consumer, permitindo que o mecanismo de retry/DLQ existente
  seja acionado; uma rejeição de negócio (CA3/CA4/CA6) nunca propaga exceção.
- [ ] **CA9** — `GET /payments/:orderId` para um `orderId` com pagamento existente retorna **200** com
  os dados do pagamento (incluindo `status`, `amount`, `paymentMethod`, `transactionId`,
  `rejectionReason`, `processedAt`).
- [ ] **CA10** — `GET /payments/:orderId` para um `orderId` sem nenhum pagamento retorna **404**.
- [ ] **CA11** — `GET /health` retorna **200** quando a aplicação e a conexão com o banco de dados
  estão operantes.
- [ ] **CA12** — Os endpoints e comportamentos já existentes de DLQ (`/dlq/*`) e métricas (`/metrics`,
  `/metrics/health`, `/metrics/summary`, `/metrics/reset`) continuam funcionando exatamente como
  antes, sem nenhuma alteração de assinatura ou comportamento.
- [ ] **CA13** — Nenhuma chamada de rede real (HTTP ou SDK de gateway de pagamento) é feita durante o
  processamento de um pagamento — toda a simulação ocorre em processo, via `FakePaymentGatewayService`.
- [ ] **CA14** — Todas as funções, métodos, parâmetros e variáveis criados ou alterados nesta spec
  possuem tipagem explícita (sem `any` implícito nas assinaturas públicas).
- [ ] **CA15** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Esta é a primeira spec de domínio do `payments-service` — não depende de nenhuma spec anterior deste
serviço. Depende do `EventsModule` já existente e funcional (`RabbitmqService`, `PaymentQueueService`,
`PaymentConsumerService` consumindo `payment_queue`) e da configuração de banco já preparada para
descobrir novas entidades automaticamente (`database.config.ts`).

Fora do escopo desta spec, ficam para specs futuras: qualquer notificação (webhook, evento, nova
mensagem em fila) ao `checkout-service` sobre o resultado do pagamento, incluindo a consequente
atualização do `status` da `Order` no `checkout-service`; qualquer gateway de pagamento real;
autenticação/autorização do endpoint de consulta; e qualquer endpoint de listagem/administração de
pagamentos além da consulta por `orderId`.
