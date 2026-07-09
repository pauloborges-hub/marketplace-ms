# SPEC: Integração do `products-service` ao `api-gateway` (`GET /health`, Swagger, exposição de `/products/*` e fluxo E2E via gateway)

> **Objetivo:** Finalizar a integração ponta a ponta entre o `products-service` (porta 3001) e o
> `api-gateway` (porta 3005), de forma que criação e consulta de produtos funcionem quando
> acessadas **através do gateway**, e que o gateway consiga monitorar a saúde do
> `products-service`.
>
> **Escopo desta spec:**
> - No `products-service`: um endpoint público de health check (`GET /health`) e a documentação
>   Swagger/OpenAPI em `/api`.
> - No `api-gateway`: expor as rotas `/products/*` (hoje inexistentes no gateway) encaminhando para
>   o `products-service`, reaproveitando a infraestrutura de proxy já existente; confirmar a
>   configuração de `PRODUCTS_SERVICE_URL`; e garantir o repasse do header `Authorization`.
> - Um fluxo E2E verificável via `curl`/Postman, passando pelo gateway.
>
> **Fora de escopo:** qualquer alteração no **mecanismo** de proxy do gateway (circuit breaker,
> retry, timeout, fallback) ou nos **guards** de autenticação existentes (`JwtAuthGuard`,
> `RoleGuard`) — todos permanecem como estão, apenas reutilizados. Também estão fora de escopo:
> atualização/remoção de produtos, paginação, filtros, cache de catálogo no gateway além do
> fallback já existente, e qualquer mudança nos endpoints já implementados do `products-service`
> (spec 03 e spec 04). Nenhum código é definido aqui — apenas **o que** deve ser feito.

---

## 1. Contexto

Esta é a quinta spec do `products-service`, na sequência de [`01 - scaffold`](./01%20-%20scaffold.md),
[`02 - jwt-authentication`](./02%20-%20jwt-authentication.md), [`03 - product-creation`](./03%20-%20product-creation.md)
e [`04 - product-listing`](./04%20-%20product-listing.md). É a primeira spec que abrange **os dois
serviços** (products-service e api-gateway), pois trata da integração entre eles — no mesmo padrão
já adotado pela integração equivalente do `users-service` ao gateway.

### 1.1 O que já existe no `products-service`

- `ProductsModule` com `ProductsController` e `ProductsService`, expondo `POST /products`
  (protegido, restrito a usuários `seller`), `GET /products`, `GET /products/seller/:sellerId` e
  `GET /products/:id` (públicos, via `@Public()`) — specs 03 e 04.
- `JwtAuthGuard` aplicado globalmente (`APP_GUARD`): toda rota exige token válido, exceto as
  marcadas com `@Public()`.
- `AppController` com `GET /` retornando `"Hello World!"` — **protegido** pelo guard global (não é
  público) e **não** é um health check.
- `main.ts` habilita CORS e `ValidationPipe` global. **Não** há Swagger configurado e **não** há
  endpoint `/health`.
- Serviço roda na porta 3001 (via `PORT`), com `JWT_SECRET=dev-only-change-me-please` no `.env`.
- `@nestjs/swagger` **não** está entre as dependências do `package.json` ainda.

### 1.2 O que já existe no `api-gateway`

- Infraestrutura de proxy resiliente (`ProxyService`) com circuit breaker, retry com backoff,
  timeout e fallback — **funcional e fora do escopo de alteração**. O fallback específico para o
  serviço `products` já está implementado: em falha de uma requisição `GET`, retorna uma resposta
  de catálogo vazio a partir de cache; em falha de uma requisição de escrita, retorna erro de
  serviço indisponível.
- Guards de autenticação (`JwtAuthGuard` via Passport, `RoleGuard`) — **funcionais e fora do escopo
  de alteração**.
- `serviceConfig` (`gateway.config.ts`) já define a entrada `products`, lendo
  `PRODUCTS_SERVICE_URL` do ambiente (com fallback para `http://localhost:3001`).
- `HealthCheckService` já inclui `products` na lista de serviços verificados em
  `checkAllServices()`, consultando `GET {PRODUCTS_SERVICE_URL}/health`.
- Swagger já configurado em `/api` para o próprio gateway, já com a tag `"Products"` predefinida na
  descrição da API (`main.ts`), embora **nenhuma rota** a utilize ainda.
- `.env` com `PORT=3005`, `PRODUCTS_SERVICE_URL=http://localhost:3001` e
  `JWT_SECRET=dev-only-change-me-please` — **mesmo valor** de secret usado no `products-service`
  (diferente do cenário encontrado na integração do `users-service`, aqui os secrets já estão
  alinhados).
- **Não existe** nenhum `ProductsController`/`ProductsModule` no gateway: nenhuma rota `/products/*`
  é exposta hoje, apesar de o `serviceConfig` e o fallback do `ProxyService` já estarem preparados
  para o serviço `products`.

### 1.3 Lacunas que impedem o fluxo E2E hoje

Levantadas a partir da leitura do código atual. **Nenhuma delas exige alterar o mecanismo de proxy
ou os guards** — são criações de endpoint (no products-service) e de rotas/módulo (no gateway),
reaproveitando a infraestrutura já existente. Os pontos do gateway estão detalhados na seção 8.

1. O `products-service` não expõe `GET /health` nem Swagger.
2. O health check do gateway consulta `GET {PRODUCTS_SERVICE_URL}/health`, que hoje retorna 404
   (rota inexistente) — logo, o gateway reporta o `products-service` como indisponível.
3. As rotas `/products/*` **não estão expostas no gateway** — não existe controller nem módulo para
   elas, apesar da infraestrutura de proxy e do fallback já estarem prontos.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 nos dois serviços (mesmo padrão dos módulos existentes).
- **Documentação:** `@nestjs/swagger` (mesma lib já usada no gateway e a ser adicionada como
  dependência do `products-service`).
- **Autenticação:** o `GET /health` do `products-service` é uma rota **pública** (`@Public()`), no
  mesmo mecanismo já usado pelos endpoints de consulta da spec 04.
- **Integração entre serviços:** o gateway continua sendo o único ponto de entrada externo; o
  `products-service` não precisa conhecer o gateway. A comunicação gateway → products-service usa a
  infraestrutura de proxy **já existente** (`ProxyService`, `serviceConfig`), sem modificá-la.
- **Rotas do gateway:** as novas rotas `/products/*` do gateway devem seguir o mesmo padrão já usado
  pelo `UsersController` do gateway (controller dedicado, delegando ao `ProxyService`, com
  `@ApiTags('Products')` e documentação Swagger).
- **Configuração:** `PRODUCTS_SERVICE_URL` vem de variável de ambiente; nenhum valor sensível é
  fixado em código.
- O projeto deve continuar **enxuto** — sem novas dependências ou abstrações além do necessário
  para esta spec.

---

## 3. Requisitos funcionais

### Parte A — `products-service`

#### RF1 — Endpoint `GET /health`
- Deve expor a rota `GET /health`, **pública** (`@Public()`), acessível **sem** token.
- Deve retornar exatamente o objeto `{ status: "ok", service: "products-service" }`.
- Deve responder com **200 OK**.
- É a rota consultada pelo health check do gateway (`GET {PRODUCTS_SERVICE_URL}/health`); portanto,
  precisa ser pública para não retornar 401.
- Não substitui nem remove o `GET /` existente (que está fora de escopo).

#### RF2 — Documentação Swagger/OpenAPI
- Deve haver documentação OpenAPI gerada automaticamente, acessível em `GET /api`.
- Deve ser configurada com **título** "Products Service" e **versão** "1.0".
- Deve declarar suporte a **Bearer Auth** (JWT), de modo que seja possível informar um token no
  Swagger UI e usá-lo na rota protegida documentada (`POST /products`).
- Deve, no mínimo, listar as rotas existentes do serviço (products, health), incluindo a criada por
  esta spec.
- A página do Swagger deve ser acessível **sem** token (a proteção de rotas do serviço não deve
  bloquear o acesso à documentação em `/api`).

### Parte B — `api-gateway`

> As exigências abaixo são de **roteamento** e **configuração**, reaproveitando a infraestrutura
> existente (`ProxyService`, guards, fallback). **Não** devem alterar o mecanismo de proxy (circuit
> breaker, retry, timeout, fallback) nem os guards. Veja a seção 8 para o estado atual observado.

#### RF3 — Configuração de `PRODUCTS_SERVICE_URL`
- O `.env` do gateway deve definir `PRODUCTS_SERVICE_URL=http://localhost:3001`.
- A configuração do gateway deve efetivamente **ler** essa mesma variável, de modo que a URL do
  `products-service` venha da variável de ambiente e não apenas de um valor padrão.
- Este requisito já está satisfeito hoje; esta spec exige apenas a **confirmação** de que
  permanece correto (sem regressão), não uma alteração.

#### RF4 — Exposição das rotas `/products/*` no gateway
- O gateway deve expor as seguintes rotas, encaminhando cada uma para a rota real correspondente do
  `products-service`, utilizando a infraestrutura de proxy **já existente** (`ProxyService`, com seu
  circuit breaker/retry/timeout/fallback), sem alterá-la:
  - `POST /products` → `products-service` `POST /products`.
  - `GET /products` → `products-service` `GET /products`.
  - `GET /products/seller/:sellerId` → `products-service` `GET /products/seller/:sellerId`.
  - `GET /products/:id` → `products-service` `GET /products/:id`.
- O caminho encaminhado a jusante deve corresponder exatamente à rota real do `products-service`
  (mesmos prefixos e segmentos), de modo que o `products-service` reconheça a requisição.
- No gateway, assim como no `products-service` (spec 04, RF5), a rota
  `GET /products/seller/:sellerId` deve ser declarada **antes** da rota `GET /products/:id`, para
  que o segmento fixo `seller` não seja interpretado como valor do parâmetro dinâmico `:id`.

#### RF5 — Autenticação e autorização das rotas no gateway
- `GET /products`, `GET /products/seller/:sellerId` e `GET /products/:id` devem ser acessíveis pelo
  gateway **sem** exigir token — o gateway não deve bloquear essas requisições por falta de
  `Authorization`, no mesmo espírito de acesso público já definido pela spec 04.
- `POST /products` deve ser **protegida** no gateway pelo `JwtAuthGuard` já existente: sem um token
  válido, o gateway rejeita a requisição com **401 Unauthorized** antes mesmo de encaminhar ao
  `products-service`.
- A verificação de que o usuário autenticado possui o papel `seller` para `POST /products` continua
  sendo responsabilidade do `products-service` (spec 03); esta spec não introduz uma checagem de
  papel adicional no gateway.

#### RF6 — Repasse do header `Authorization`
- Em toda requisição encaminhada ao `products-service` (públicas e protegidas), o gateway deve
  **repassar** o header `Authorization` recebido do cliente, quando presente.
- Isso é necessário para que `POST /products` no `products-service` consiga identificar o vendedor
  autenticado (`req.user`), e para que os endpoints públicos de consulta continuem funcionando de
  forma idêntica com ou sem token (spec 04, RF6/CA9).

---

## 4. Fluxo completo esperado via gateway (porta 3005)

Todos os passos abaixo são feitos contra o gateway (`http://localhost:3005`), nunca diretamente
contra o `products-service`. O login (passo 1) depende da integração do `users-service` ao gateway,
já coberta por spec própria daquele serviço.

1. **`POST /auth/login`** → gateway encaminha para `users-service` → retorna um token JWT.
2. **`POST /products`** (com `Authorization: Bearer <token>` de um usuário `seller`) → gateway
   valida o token (guard) → encaminha para `products-service` `POST /products`, repassando o
   `Authorization` → produto é criado; resposta conforme a spec 03.
3. **`GET /products`** (com ou sem `Authorization`) → gateway encaminha para `products-service`
   `GET /products` → retorna o catálogo de produtos ativos; resposta conforme a spec 04.
4. **`GET /products/:id`** (com ou sem `Authorization`) → gateway encaminha para `products-service`
   `GET /products/:id` → retorna o produto correspondente, ou **404** se inexistente.

Em paralelo:
- O health check do gateway, ao consultar `GET {PRODUCTS_SERVICE_URL}/health`, recebe **200** com
  `{ status: "ok", service: "products-service" }`, passando a reportar o `products-service` como
  saudável.

---

## 5. Estruturas de dados e respostas esperadas

### 5.1 `GET /health` (products-service)

Corpo de sucesso (**200 OK**):

```
{ "status": "ok", "service": "products-service" }
```

- Sempre público; nunca retorna 401.

### 5.2 `GET /api` (Swagger do products-service)

- Página HTML do Swagger UI, acessível sem autenticação, com título "Products Service", versão
  "1.0" e suporte a Bearer Auth.

### 5.3 Rotas `/products/*` via gateway

- Mesmos formatos de entrada e saída já definidos nas specs 03 (`POST /products`) e 04
  (`GET /products`, `GET /products/seller/:sellerId`, `GET /products/:id`) — o gateway não altera
  o formato dos dados, apenas encaminha a requisição e repassa a resposta do `products-service`.
- `POST /products` sem token, via gateway, retorna **401 Unauthorized** (barrado pelo guard do
  gateway, sem sequer alcançar o `products-service`).

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva (via `curl`/Postman).

**No `products-service` (acesso direto, porta 3001):**

- [ ] **CA1** — `GET /health` **sem** token retorna **200** com exatamente
      `{ "status": "ok", "service": "products-service" }`.
- [ ] **CA2** — `GET /api` responde com a documentação Swagger (título "Products Service", versão
      "1.0", com opção de Bearer Auth), acessível sem token.
- [ ] **CA3** — Os endpoints já existentes (`POST /products`, `GET /products`,
      `GET /products/seller/:sellerId`, `GET /products/:id`) continuam funcionando exatamente como
      nas specs 03 e 04, sem alterações de comportamento causadas por esta spec.

**Via `api-gateway` (fluxo E2E, porta 3005):**

- [ ] **CA4** — `POST /auth/login` no gateway retorna um token JWT válido de um usuário `seller`.
- [ ] **CA5** — `POST /products` no gateway, com o `Authorization: Bearer <token>` do CA4, cria o
      produto no `products-service` e retorna a mesma resposta esperada da spec 03.
- [ ] **CA6** — `POST /products` no gateway **sem** token (ou com token inválido) retorna
      **401 Unauthorized**, sem que a requisição chegue ao `products-service`.
- [ ] **CA7** — `GET /products` no gateway, sem token, retorna **200** com o catálogo de produtos
      ativos, mesma resposta esperada da spec 04.
- [ ] **CA8** — `GET /products/:id` no gateway, sem token, com o `id` do produto criado no CA5,
      retorna **200** com os dados completos do produto.
- [ ] **CA9** — `GET /products/:id` no gateway com um `id` inexistente retorna **404 Not Found**.
- [ ] **CA10** — `GET /products/seller/:sellerId` no gateway, sem token, retorna **200** com os
      produtos ativos do vendedor informado.
- [ ] **CA11** — `GET /products/seller/:sellerId` no gateway não é interceptada pela rota
      `GET /products/:id` (ou seja, `seller` nunca é tratado como valor de `id`).
- [ ] **CA12** — O health check por serviço do gateway (`GET /health/services`) passa a reportar o
      `products-service` como saudável (consequência do `GET /health` público, RF1).

---

## 7. Estado atual do `api-gateway` e pontos a verificar

Observações levantadas na leitura do código atual do gateway. Servem de insumo para o **plano de
implementação**; a resolução de cada ponto deve ocorrer **sem** alterar o mecanismo de proxy
(circuit breaker/retry/timeout/fallback) nem os guards — apenas criação de rotas e configuração.

1. **Rotas `/products/*` inexistentes:** a infraestrutura de proxy (`ProxyService`), o
   `serviceConfig` para `products` e o fallback específico do serviço `products` já existem e estão
   prontos, mas **não há nenhum controller ou módulo** no gateway que exponha `/products/*`. Este é
   o principal trabalho desta spec no lado do gateway (RF4).
2. **`PRODUCTS_SERVICE_URL` já configurada corretamente:** o nome lido pela configuração do gateway
   (`gateway.config.ts`) já coincide com a variável do `.env` — apenas confirmar que não há
   regressão (RF3).
3. **Secret JWT já alinhado:** o `JWT_SECRET` do gateway e o do `products-service` já têm o mesmo
   valor hoje — diferente do que foi observado na integração do `users-service`, não há ajuste de
   configuração necessário aqui.
4. **Repasse do `Authorization`:** ao criar as novas rotas de `/products/*`, garantir que o padrão
   já usado pelo `UsersController` (repasse do header `Authorization` ao `ProxyService`) seja
   seguido também para `products` (RF6).
5. **Tag Swagger já preparada:** o `main.ts` do gateway já declara a tag `"Products"` na descrição
   da API; as novas rotas devem usar `@ApiTags('Products')` para aparecerem agrupadas
   corretamente, sem necessidade de alterar a configuração do Swagger do gateway.

---

## 8. Dependências e sequência

Depende das specs [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md) (`JwtAuthGuard`
global, `@Public()`), [`03 - product-creation`](./03%20-%20product-creation.md) (`POST /products`) e
[`04 - product-listing`](./04%20-%20product-listing.md) (`GET /products`,
`GET /products/seller/:sellerId`, `GET /products/:id`) deste serviço.

Depende também da integração do `users-service` ao gateway (spec própria daquele serviço) para o
passo de login do fluxo E2E (seção 4, passo 1) — esta spec não redefine esse fluxo, apenas o
reutiliza.

Requer a adição do `@nestjs/swagger` como nova dependência de runtime no `products-service` (para
RF2), no mesmo padrão já usado pelo `api-gateway`. No gateway, não introduz novas dependências —
apenas um novo controller/módulo reaproveitando bibliotecas já presentes.

Ordem sugerida de implementação (a ser detalhada no plano):
1. `products-service`: `GET /health` público (RF1) — desbloqueia o health check do gateway.
2. `products-service`: Swagger em `/api` (RF2).
3. `api-gateway`: confirmar `PRODUCTS_SERVICE_URL` (RF3, já correto).
4. `api-gateway`: criar o controller/módulo que expõe `/products/*` (RF4), com a autenticação
   correta por rota (RF5) e o repasse do `Authorization` (RF6), reutilizando a infraestrutura de
   proxy existente.
5. Validação E2E via `curl`/Postman (seção 6).

Specs futuras (fora do escopo aqui) poderão cobrir: atualização/remoção de produtos via gateway,
paginação e filtros expostos no gateway, e a integração dos demais serviços (checkout, payments) ao
gateway.
