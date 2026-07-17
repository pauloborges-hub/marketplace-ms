# Spec: Integrar payments-service ao api-gateway e testar o fluxo E2E completo do marketplace-ms

## Contexto

O marketplace-ms é composto pelos serviços `users-service` (3000), `products-service` (3001), `checkout-service` (3003), `payments-service` (3004), `api-gateway` (3005) e RabbitMQ (5672).

Auditoria do estado atual do repositório (2026-07-16) encontrou o seguinte:

- **payments-service já está funcional**: entidade `Payment` (status `pending`/`approved`/`rejected`), `FakePaymentGatewayService` (aprova valores normais; rejeita valores cujos centavos terminam em `.99` e valores acima do limite de R$ 10.000, com latência artificial de 500–2000ms), consumer RabbitMQ que processa mensagens de pedido publicadas pelo checkout-service, endpoint `GET /payments/:orderId` e health check. Nenhuma alteração de código é necessária neste serviço.
- **api-gateway já expõe proxy real (controller + rotas) apenas para `users-service` e `products-service`** (`UsersController` e `ProductsController`, ambos usando `ProxyService`). Para `checkout` e `payments`, o `gateway.config.ts` já define `url`/`timeout`, e o `ProxyService`/`health-check.service.ts` já tratam esses dois nomes de serviço em seus fallbacks e health checks — mas **não existe nenhum controller/módulo que exponha rotas HTTP de checkout (carrinho, checkout, pedidos) nem de pagamentos através do gateway**. Ou seja, o proxy de checkout também está incompleto, não só o de payments.
- **Decisão de escopo**: esta spec cobre exclusivamente a criação do proxy de **payments** no gateway. O proxy de carrinho/checkout/pedidos (`CartController`/`OrdersController` equivalentes no gateway) **não será criado aqui** — é um gap pré-existente, fora do escopo pedido, e deve ser tratado em uma spec futura caso o time queira expor esse fluxo via gateway.
- **checkout-service possui um endpoint de teste** (`POST /test/send-message` em `AppController`) que publica uma mensagem fake de pedido direto na fila do RabbitMQ. Foi útil durante o desenvolvimento do consumer de pagamentos, mas não faz parte do fluxo de negócio e deve ser removido.

## Objetivo

1. Expor `GET /payments/:orderId` através do `api-gateway`, seguindo o mesmo padrão arquitetural já usado para `users` e `products` (proxy autenticado via `ProxyService` + `JwtAuthGuard`).
2. Remover o endpoint de teste `POST /test/send-message` do `checkout-service`, junto com qualquer dependência que só existia para sustentá-lo.
3. Validar, com um teste E2E, o fluxo de ponta a ponta do marketplace **até onde o gateway atualmente permite** (autenticação, catálogo e consulta de pagamento via gateway; carrinho/checkout/pedido direto no checkout-service, dado o gap descrito no Contexto), cobrindo tanto o caminho de pagamento aprovado quanto o de pagamento rejeitado.

## Fora de escopo

- Qualquer alteração de lógica de negócio, entidades ou endpoints do `payments-service`.
- Proxy de carrinho/checkout/pedidos (`/cart`, `/cart/items`, `/cart/checkout`, `/orders/:id`) no `api-gateway` — gap pré-existente, não coberto por esta spec.
- Webhook ou qualquer mecanismo de atualização assíncrona do status do pedido (`Order.status`) no checkout-service a partir do resultado do pagamento. O pedido permanece com status `pending` após o checkout, independentemente do resultado do pagamento — isso é uma limitação conhecida e aceita para esta spec.
- Qualquer alteração em `users-service` ou `products-service`.
- Alterações de schema, migrations, docker-compose ou variáveis de ambiente.
- Endpoints de listagem/administração de pagamentos além de `GET /payments/:orderId` (ex.: listar todos os pagamentos de um usuário).

## Requisitos funcionais

### 1. api-gateway — proxy de payments

1.1. Criar um `PaymentsModule` em `api-gateway/src/payments/`, estruturalmente equivalente ao `UsersModule` já existente (importa `ProxyModule`, registra o controller de proxy).

1.2. Criar um `PaymentsProxyController` nesse módulo, expondo `GET /payments/:orderId`:
   - Deve ser protegido por autenticação JWT (mesmo guard usado em `UsersController`/`ProductsController` para rotas autenticadas), retornando 401 para requisições sem token válido.
   - Deve delegar a chamada ao `payments-service` via `ProxyService`, reaproveitando o mecanismo existente de proxy (circuit breaker, retry, timeout e fallback), sem lógica de proxy própria.
   - Deve repassar o `orderId` recebido na URL do gateway para a URL correspondente no payments-service (`GET /payments/:orderId`).
   - Deve propagar o header `Authorization` e as informações do usuário autenticado para o serviço downstream, seguindo o mesmo padrão já usado nas rotas autenticadas de `users` e `products`.
   - Erros retornados pelo payments-service (ex.: `404` quando o pagamento não existe, `400` quando `orderId` não é um UUID válido) devem ser repassados ao cliente do gateway com o mesmo status code, sem serem mascarados pelo fallback — mesmo comportamento de passthrough de erros 4xx já implementado no `ProxyService` para os demais serviços.
   - Deve seguir o mesmo padrão de documentação Swagger (tags, operação, bearer auth) usado nos demais controllers de proxy do gateway.

1.3. Registrar `PaymentsModule` nos `imports` do `AppModule` do api-gateway, ao lado de `UsersModule` e `ProductsModule`.

1.4. Nenhuma alteração é necessária em `gateway.config.ts` (a entrada `payments` já existe) nem no `ProxyService` (o fallback para `payments` já existe em `createServiceFallback`).

### 2. checkout-service — remoção do endpoint de teste

2.1. Remover o handler `POST /test/send-message` do `AppController` do checkout-service.

2.2. Remover, do `AppController`, qualquer dependência (import, injeção de construtor) que só existia para sustentar esse endpoint — atualmente isso inclui a injeção de `PaymentQueueService` e o import de `PaymentOrderMessage`, que não são usados por `getHello()` nem por `getHealth()`.

2.3. Atualizar `checkout-service/src/app.controller.spec.ts` para refletir a nova assinatura do `AppController`, removendo o provider mock de `PaymentQueueService` que deixa de ser necessário no `TestingModule`.

2.4. Ao final da limpeza, `AppController` deve expor apenas `GET /` (`getHello`) e `GET /health` (`getHealth`), sem nenhuma rota de teste. O restante do fluxo de publicação de pagamentos (via `OrdersService`/`PaymentQueueService`, acionado pelo checkout real em `POST /cart/checkout`) não é afetado.

### 3. Teste E2E completo do marketplace

Adicionar uma suíte de teste E2E (na pasta de testes E2E mais apropriada do repositório — a definir na fase de implementação, junto aos testes E2E já existentes de algum dos serviços ou do próprio gateway) que exercite o seguinte roteiro, ponta a ponta, contra instâncias reais dos serviços (todos rodando localmente, com RabbitMQ ativo):

1. **Registro**: registrar um usuário seller e um usuário buyer via `POST /auth/register` no api-gateway.
2. **Login como seller**: autenticar via `POST /auth/login` no api-gateway e obter o token JWT do seller.
3. **Criação de produtos**: com o token do seller, criar dois produtos via `POST /products` no api-gateway:
   - um produto com preço "normal" (que não termina em `.99` e está abaixo do limite de aprovação do gateway de pagamento fake);
   - um produto com preço terminado em `.99`.
4. **Login como buyer**: autenticar via `POST /auth/login` no api-gateway e obter o token JWT do buyer.
5. **Navegação no catálogo**: com o token do buyer, listar o catálogo via `GET /products` no api-gateway e confirmar que os dois produtos criados aparecem.
6. **Fluxo 1 — produto de preço normal**:
   a. Adicionar o produto de preço normal ao carrinho do buyer (via checkout-service, dado o gap de proxy descrito no Contexto).
   b. Consultar o carrinho e confirmar que o item foi adicionado corretamente.
   c. Finalizar o checkout desse carrinho (via checkout-service), obtendo o `orderId` gerado.
   d. Consultar o pedido criado (via checkout-service) e confirmar seus dados (status, total, itens).
   e. Consultar o pagamento correspondente via `GET /payments/:orderId` **através do api-gateway**, aguardando (com poll/retry, já que o processamento do pagamento é assíncrono via fila) até que o status deixe de ser `pending`, e confirmar que o status final é `approved`.
7. **Fluxo 2 — produto de preço `.99`**:
   a. Repetir os passos de adicionar ao carrinho, ver carrinho e finalizar o checkout, agora usando o produto de preço `.99`.
   b. Consultar o pagamento correspondente via `GET /payments/:orderId` através do api-gateway, aguardando o processamento assíncrono, e confirmar que o status final é `rejected`.

O teste deve autenticar todas as chamadas ao api-gateway com o token JWT apropriado (seller ou buyer, conforme o passo) e deve poder ser executado de ponta a ponta contra os serviços reais em execução local, sem mocks de rede.

## Critérios de aceite

1. `api-gateway/src/payments/` existe, contendo um `PaymentsModule` e um controller que expõe `GET /payments/:orderId`.
2. Uma requisição autenticada `GET /payments/:orderId` ao api-gateway (porta 3005), para um `orderId` de pagamento já processado pelo payments-service, retorna o mesmo payload (status 200 e corpo) que uma chamada equivalente direta ao payments-service (porta 3004).
3. Uma requisição não autenticada a `GET /payments/:orderId` no api-gateway retorna 401.
4. Uma requisição autenticada a `GET /payments/:orderId` no api-gateway para um `orderId` inexistente retorna o mesmo status de erro (404) que o payments-service retornaria diretamente.
5. `PaymentsModule` está registrado em `api-gateway/src/app.module.ts`.
6. `grep -r "test/send-message" checkout-service/src` não retorna nenhuma ocorrência.
7. `checkout-service/src/app.controller.ts` não injeta mais `PaymentQueueService` nem importa `PaymentOrderMessage`.
8. `npx jest` (dentro de `checkout-service`) passa com 0 falhas, incluindo o `app.controller.spec.ts` atualizado.
9. O `AppController` do checkout-service expõe apenas `GET /` e `GET /health` como rotas.
10. A suíte de teste E2E descrita na seção 3 existe, roda contra instâncias reais dos serviços (sem mocks de rede) e passa de ponta a ponta, cobrindo:
    - registro e login de seller e buyer;
    - criação dos dois produtos pelo seller;
    - listagem do catálogo pelo buyer via gateway;
    - o fluxo completo de carrinho → checkout → consulta de pedido → consulta de pagamento aprovado, para o produto de preço normal;
    - o mesmo fluxo para o produto `.99`, terminando em pagamento rejeitado;
    - todas as consultas de pagamento (`GET /payments/:orderId`) feitas através do api-gateway, autenticadas via JWT.
11. Nenhum arquivo de `users-service`, `products-service` ou `payments-service` foi alterado (`git diff --stat` restrito a esses diretórios está vazio).
12. Nenhuma alteração foi feita em `Order.status` do checkout-service nem introduzido qualquer webhook de atualização de status de pedido.

## Riscos e observações

- O processamento de pagamento é assíncrono (fila RabbitMQ + latência artificial de 500–2000ms no `FakePaymentGatewayService`). O teste E2E precisa tolerar essa espera (poll com timeout) ao consultar `GET /payments/:orderId`; uma única tentativa imediatamente após o checkout provavelmente encontrará o pagamento ainda `pending`.
- Como o pedido não é atualizado com o resultado do pagamento (fora de escopo, ver seção "Fora de escopo"), a única fonte de verdade sobre aprovação/rejeição no fluxo E2E é o próprio `GET /payments/:orderId` — o `GET /orders/:id` sempre mostrará o pedido como criado, independentemente do resultado do pagamento.
- O gap de proxy de carrinho/checkout/pedidos no gateway (ver Contexto) faz com que o teste E2E, apesar de ser chamado de "via gateway", precise falar diretamente com o checkout-service (porta 3003) para os passos de carrinho/checkout/pedido. Isso deve ficar explícito no nome/descrição do teste e nos comentários de setup, para não sugerir uma cobertura de gateway que não existe.
- O teste depende de todos os serviços (incluindo RabbitMQ) estarem de pé localmente antes da execução; não há orquestração automática de subida de serviços prevista nesta spec.
