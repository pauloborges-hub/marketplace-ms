# SPEC: Integração do `users-service` ao `api-gateway` (`GET /auth/validate-token`, `GET /health`, Swagger, refatoração de `/auth/*` para o `ProxyService` e fluxo E2E via gateway)

> **Objetivo:** Finalizar a integração ponta a ponta entre o `users-service` (porta 3000) e o
> `api-gateway` (porta 3005), de forma que registro, login e as consultas de usuários funcionem
> quando acessados **através do gateway**, e que o gateway consiga validar tokens e monitorar a
> saúde do `users-service`. Corrige também um problema arquitetural: as rotas `/auth/*` do gateway
> hoje **não** passam pela infraestrutura de proxy resiliente (`ProxyService`), pois o
> `AuthController` delega a um `AuthService` que faz chamadas HTTP diretas ao `users-service` via
> `HttpService`. Isso contorna circuit breaker, retry, timeout e fallback, e **engole** erros reais
> do backend (ex.: um `409 Conflict` no registro por e-mail duplicado vira um `401 Unauthorized`
> genérico "Registration failed"). Esta spec unifica `/auth/*` e `/users/*` sob o mesmo padrão de
> proxy já usado pelo `ProductsController` do `products-service`
> ([spec 05](../../../products-service/docs/specs/05%20-%20api-gateway-integration.md)).
>
> **Escopo desta spec:**
> - No `users-service`: um endpoint protegido de validação de token (`GET /auth/validate-token`),
>   um endpoint público de health check (`GET /health`), e a documentação Swagger/OpenAPI em
>   `/api`.
> - No `api-gateway`: consolidar as rotas `/auth/*` e `/users/*` em um único `UsersController`
>   (seguindo o padrão do `ProductsController`), delegando integralmente a
>   `ProxyService.proxyRequest('users', ...)`; remover o `AuthController` atual e reduzir o
>   `AuthService` (que hoje fazem chamadas HTTP diretas ao `users-service` para login/registro) às
>   responsabilidades ainda necessárias fora desse fluxo; e corrigir a infraestrutura de proxy
>   (`ProxyService`, `RetryService`, `CircuitBreakerService`) para repassar erros `4xx` do backend ao
>   cliente sem retry e sem contabilizá-los como falha do circuit breaker.
> - Um fluxo E2E verificável via `curl`/Postman, passando pelo gateway, incluindo cenários de erro
>   (e-mail duplicado, credenciais inválidas).
>
> **Fora de escopo:** alterações no comportamento de retry/timeout/fallback para erros `5xx` ou
> falhas de rede/timeout (permanecem como estão — a única mudança no mecanismo de proxy é a exceção
> explícita para `4xx` descrita acima) e os **guards** de autenticação do gateway (`JwtAuthGuard`,
> `RoleGuard`) — permanecem como estão, apenas reutilizados. Também estão fora de escopo: session
> management (`validateSessionToken`, `x-session-token`, `SessionGuard`), refresh tokens, logout,
> `RoleGuard`, novos endpoints de escrita em usuários, e paginação. Nenhum código é definido aqui —
> apenas **o que** deve ser feito.

---

## 1. Contexto

Esta é a sexta spec do `users-service`, na sequência de
[`05 - users-query-endpoints`](./05%20-%20users-query-endpoints.md). Ela é a primeira spec que
abrange **os dois serviços** (users-service e api-gateway), pois trata da integração entre eles.

### 1.1 O que já existe no `users-service`

- `AuthModule` com `POST /auth/register` e `POST /auth/login` (ambos marcados como `@Public()`);
  o login emite um JWT assinado com `JWT_SECRET`, payload `{ sub, email, role }`, expiração de 24h.
- `JwtAuthGuard` aplicado globalmente (`APP_GUARD`): toda rota exige token válido, exceto as
  marcadas com `@Public()`. Em rota protegida, `req.user` contém `id`, `email` e `role`.
- `UsersModule` com `GET /users/profile`, `GET /users/sellers` e `GET /users/:id`, todos protegidos.
- `AppController` com `GET /` retornando `"Hello World!"` — **protegido** pelo guard global (não é
  público) e **não** é um health check.
- `GET /auth/validate-token` (protegido, sem `@Public()`) já existe em `AuthController`, retornando
  `{ userId, email, role }` a partir de `req.user` — RF1 já está satisfeito.
- `GET /health` (`@Public()`) já existe em `AppController`, retornando exatamente
  `{ status: "ok", service: "users-service" }` — RF2 já está satisfeito.
- `main.ts` habilita CORS, `ValidationPipe` global e já configura Swagger em `/api` (título "Users
  Service", versão "1.0", Bearer Auth) via `@nestjs/swagger`, já presente no `package.json` — RF3
  já está satisfeito.
- Serviço roda na porta 3000 (via `PORT`), com `JWT_SECRET` definido no `.env`.
- RF1, RF2 e RF3 (seção 3, Parte A) portanto já estão implementados; permanecem nesta spec como
  definição do comportamento esperado e critérios de aceite (CA1-CA5), não como trabalho pendente.

### 1.2 O que já existe no `api-gateway`

- Infraestrutura de proxy resiliente (`ProxyService`) com circuit breaker, retry com backoff,
  timeout e fallback — usada hoje pelas rotas `/products/*` e por parte de `/users/*`.
- `UsersController` (`api-gateway/src/users/`) já expõe `GET /users/profile`, `GET /users/sellers`
  e `GET /users/:id`, todas protegidas por `JwtAuthGuard`, delegando a
  `ProxyService.proxyRequest('users', ...)` e repassando o header `Authorization` e o usuário
  autenticado (`@CurrentUser()`) — este é o padrão de referência a ser **estendido** para `/auth/*`.
- `ProductsController`/`ProductsModule` (`api-gateway/src/products/`) seguem o mesmo padrão de
  proxy para `/products/*` — segunda referência de como estruturar um controller fino sobre o
  `ProxyService`.
- `AuthController` (`api-gateway/src/auth/controllers/auth.controller.ts`) expõe
  `POST /auth/login` e `POST /auth/register`, mas delega a um `AuthService`
  (`api-gateway/src/auth/service/auth.service.ts`) que faz chamadas HTTP diretas ao
  `users-service` via `HttpService` (`firstValueFrom(this.httpService.post(...))`), **sem passar
  pelo `ProxyService`** — logo, sem circuit breaker, retry, timeout ou fallback.
  - Tanto `login` quanto `register` capturam **qualquer** erro da chamada HTTP num `catch`
    genérico e relançam `UnauthorizedException` com uma mensagem fixa ("Invalid login
    credentials" / "Registration failed"), descartando o status code e o corpo reais retornados
    pelo `users-service`. Um `409 Conflict` (e-mail duplicado) chega ao cliente como
    `401 Unauthorized`.
  - `AuthModule` também declara `JwtStrategy` (usada pelo `JwtAuthGuard` global via Passport) —
    essa estratégia **não depende** do `AuthService`/`AuthController` e precisa continuar
    registrada após a remoção deles.
- Health check próprio (`/health`) e checagem por serviço, que consulta a saúde de cada serviço
  fazendo `GET {SERVICE_URL}/health`.
- Swagger já configurado em `/api` para o próprio gateway.
- `.env` com `PORT=3005`, `USERS_SERVICE_URL=http://localhost:3000` e `JWT_SECRET`.

### 1.3 Lacunas que impedem o fluxo E2E correto hoje

Levantadas a partir da leitura do código atual dos dois serviços. RF1-RF3 do `users-service` já
estão implementados (ver 1.1), assim como o health check do gateway (RF2/CA13) e o roteamento de
`/users/*` (ver 1.2); as lacunas reais que restam são todas do lado `api-gateway`, relacionadas a
`/auth/*`.

**No `api-gateway`:**

1. As rotas `/auth/*` (`POST /auth/register`, `POST /auth/login`) contornam o `ProxyService`: o
   `AuthController` delega a um `AuthService` que chama o `users-service` diretamente via
   `HttpService`, sem circuit breaker, retry, timeout ou fallback consistentes com o resto do
   gateway.
2. O `AuthService` engole erros reais do backend: tanto `login` quanto `register` capturam
   qualquer exceção num `catch` genérico e relançam `UnauthorizedException` com mensagem fixa —
   um `409 Conflict` de e-mail duplicado no registro chega ao cliente como `401 Unauthorized`
   "Registration failed"; um `401` de credenciais inválidas chega como "Invalid login
   credentials" (mensagem fixa do gateway, não a real do `users-service`).
3. `ProxyService`/`RetryService`/`CircuitBreakerService` não distinguem erro `4xx`
   (validação/negócio do cliente) de erro `5xx`/timeout/rede (indisponibilidade do backend):
   qualquer erro hoje dispara retry e conta para a abertura do circuit breaker, o que é incorreto
   para `4xx` — retry nunca resolve um erro de validação, e um `4xx` não indica que o backend está
   fora do ar.

**Não são lacunas** (já corretos hoje, apenas a confirmar): o nome da variável
`USERS_SERVICE_URL` já é lido corretamente pela configuração do gateway, e o `JWT_SECRET` já é o
mesmo valor (`dev-only-change-me-please`) nos dois serviços.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 nos dois serviços (mesmo padrão dos módulos existentes).
- **Documentação:** `@nestjs/swagger` (mesma lib já usada no gateway).
- **Autenticação:** o `GET /auth/validate-token` é uma rota **protegida** pelo `JwtAuthGuard` global
  do users-service (não deve ser `@Public()`); o `GET /health` é **público** (`@Public()`).
- **Integração entre serviços:** o gateway continua sendo o único ponto de entrada externo; o
  `users-service` não precisa conhecer o gateway. A comunicação gateway → users-service passa a
  usar **exclusivamente** a infraestrutura de proxy (`ProxyService`) — inclusive para `/auth/*`,
  que hoje é a única exceção a essa regra.
- **Padrão de controller no gateway:** o `UsersController` (`/auth/*` e `/users/*`) deve seguir
  exatamente o padrão já estabelecido pelo `ProductsController`/`ProductsModule`
  (`api-gateway/src/products/`) — controller fino, injeta apenas `ProxyService`, cada handler
  chama `proxyRequest(serviceName, method, path, data, headers, userInfo)` e retorna o resultado
  diretamente, sem lógica de negócio ou tratamento de erro próprio.
- **Configuração:** `USERS_SERVICE_URL` e `JWT_SECRET` vêm de variáveis de ambiente; nenhum valor
  sensível é fixado em código.
- O projeto deve continuar **enxuto** — sem novas dependências ou abstrações além do necessário
  para esta spec.

---

## 3. Requisitos funcionais

### Parte A — `users-service`

#### RF1 — Endpoint `GET /auth/validate-token`
- Deve expor a rota `GET /auth/validate-token`, **protegida** pelo `JwtAuthGuard` global (nenhuma
  marcação `@Public()`).
- Requer um token JWT válido no header `Authorization`, no formato `Bearer <token>`; sem token, ou
  com token inválido/expirado/adulterado, a requisição é rejeitada com **401 Unauthorized** (pelo
  guard global, antes do controller).
- Com um token válido, deve retornar os dados do usuário autenticado extraídos do token
  (`req.user`), nos campos: `userId`, `email` e `role`.
  - `userId` corresponde ao `id` do usuário autenticado (derivado do `sub` do token).
- A validação é feita inteiramente a partir do JWT (assinatura + payload), sem consulta ao banco.
- Destina-se a uso interno por outros componentes (por exemplo, o `api-gateway` ou outros serviços)
  para validar um token e obter a identidade do usuário. Esta spec **cria o endpoint** no
  users-service; se o gateway continua validando o JWT localmente ou passa a usar este endpoint é
  decisão do gateway e não é obrigatório para os critérios de aceite.

#### RF2 — Endpoint `GET /health`
- Deve expor a rota `GET /health`, **pública** (`@Public()`), acessível **sem** token.
- Deve retornar exatamente o objeto `{ status: "ok", service: "users-service" }`.
- Deve responder com **200 OK**.
- É a rota consultada pelo health check do gateway (`GET {USERS_SERVICE_URL}/health`); portanto,
  precisa ser pública para não retornar 401.
- Não substitui nem remove o `GET /` existente (que está fora de escopo).

#### RF3 — Documentação Swagger/OpenAPI
- Deve haver documentação OpenAPI gerada automaticamente, acessível em `GET /api`.
- Deve ser configurada com **título** "Users Service" e **versão** "1.0".
- Deve declarar suporte a **Bearer Auth** (JWT), de modo que seja possível informar um token no
  Swagger UI e usá-lo nas rotas protegidas documentadas.
- Deve, no mínimo, listar as rotas existentes do serviço (auth, users, health), incluindo as
  criadas por esta spec.
- A página do Swagger deve ser acessível **sem** token (a proteção de rotas do serviço não deve
  bloquear o acesso à documentação em `/api`).

### Parte B — `api-gateway`

> As exigências abaixo cobrem tanto **configuração/roteamento** quanto a **refatoração** das rotas
> `/auth/*` para o padrão de proxy já usado por `/users/*` e `/products/*`. A única alteração no
> **mecanismo** de proxy é a distinção entre `4xx` e `5xx`/timeout/rede (RF9); os **guards**
> permanecem inalterados. Veja a seção 7 para o checklist de refatoração e o estado atual
> observado.

#### RF4 — Configuração de `USERS_SERVICE_URL`
- O `.env` do gateway deve definir `USERS_SERVICE_URL=http://localhost:3000`, e a configuração do
  gateway (`gateway.config.ts`) deve efetivamente **ler** essa mesma variável (nome idêntico ao do
  `.env`), de modo que a URL do `users-service` venha da variável de ambiente e não apenas de um
  valor padrão.
- Este requisito já está satisfeito hoje (`serviceConfig.users.url` lê `USERS_SERVICE_URL`); esta
  spec exige apenas a **confirmação** de que permanece correto (sem regressão), não uma alteração.

#### RF5 — Consolidação de `/auth/*` e `/users/*` sob o `UsersController` via `ProxyService`
- O gateway deve expor **todas** as rotas abaixo a partir de um único controller de proxy
  (`UsersController`, em `api-gateway/src/users/`), no mesmo padrão já usado pelo
  `ProductsController` (`api-gateway/src/products/products.controller.ts`): cada handler delega
  integralmente a `ProxyService.proxyRequest('users', ...)`, sem chamadas HTTP próprias
  (`HttpService` direto) e sem lógica de tratamento de erro que substitua o status/corpo
  retornado pelo `users-service`.
  - `POST /auth/register` → `users-service` `POST /auth/register` — **pública**, sem
    `@UseGuards(JwtAuthGuard)`.
  - `POST /auth/login` → `users-service` `POST /auth/login` — **pública**, sem
    `@UseGuards(JwtAuthGuard)`.
  - `GET /auth/validate-token` → `users-service` `GET /auth/validate-token` — **protegida** por
    `@UseGuards(JwtAuthGuard)`, repassando o header `Authorization` e o usuário autenticado
    (`@CurrentUser()`), no mesmo padrão já usado por `GET /users/profile`.
  - `GET /users/profile`, `GET /users/sellers`, `GET /users/:id` — já implementadas nesse padrão;
    permanecem como estão (nenhuma mudança de comportamento exigida por esta spec).
- O `UsersController` já existente (que hoje cobre apenas `/users/*`) deve ser **estendido** para
  também assumir as rotas `/auth/*` acima — não deve ser criado um segundo controller de proxy
  paralelo para `/auth/*`.
- O caminho encaminhado a jusante deve corresponder exatamente à rota real do `users-service`
  (mesmos prefixos e segmentos).
- **Compatibilidade:** os paths, métodos HTTP e formatos de request/response de
  `/auth/register`, `/auth/login`, `/auth/validate-token`, `/users/profile`, `/users/sellers` e
  `/users/:id` não mudam para o consumidor do gateway — apenas a implementação interna (proxy via
  `ProxyService`, em vez de `HttpService` direto no `AuthService`) muda.

#### RF6 — Remoção do `AuthController` e redução do `AuthService` atuais
- O `AuthController` (`api-gateway/src/auth/controllers/auth.controller.ts`) — que hoje expõe
  `POST /auth/login` e `POST /auth/register` delegando a chamadas HTTP diretas ao `users-service`
  — deve ser **removido por completo**, já que o `UsersController` (RF5) passa a cobrir
  integralmente as mesmas rotas.
- O `AuthService` (`api-gateway/src/auth/service/auth.service.ts`) **não** pode ser removido por
  completo: o `SessionGuard` (`api-gateway/src/guards/session.guard.ts`) injeta `AuthService` e
  usa `validateSessionToken` — método fora do escopo desta spec (session management, ver "Fora de
  escopo"). O `AuthService` deve ser **reduzido**, não apagado:
  - Removidos: `login`, `register` (substituídos pelo `UsersController`/RF5) e `validateJwtToken`
    (método hoje morto — não é usado por `JwtStrategy` nem por nenhum outro componente).
  - Mantidos: `validateSessionToken` e a dependência de `HttpService` que ele usa, exatamente como
    estão hoje, sem alteração de comportamento.
- O `JwtStrategy` (`api-gateway/src/auth/strategies/jwt.strategy.ts`), usado pelo `JwtAuthGuard`
  global via Passport, **não depende** do `AuthService`/`AuthController` e deve continuar
  registrado normalmente após essa refatoração — sem regressão na validação de token pelo guard.
- Os decorators (`@Public()`, `@CurrentUser()`, `@Roles()`) e os DTOs (`LoginDto`, `RegisterDto`)
  hoje em `api-gateway/src/auth/` são reaproveitados pelo `UsersController` e **não** devem ser
  removidos.
- Com `AuthController` fora do `AuthModule` e `AuthService` reduzido, a dependência de `JwtModule`
  (usada apenas pelo `validateJwtToken` removido) deixa de ser necessária e pode ser removida do
  módulo; `PassportModule`, `HttpModule` (para o `AuthService` reduzido) e `JwtStrategy` permanecem.

#### RF7 — Repasse do header `Authorization`
- Nas requisições encaminhadas para rotas protegidas do `users-service` (`/users/*` e
  `/auth/validate-token`), o gateway deve **repassar** o header `Authorization` recebido do
  cliente.
- Isso é necessário para que o `JwtAuthGuard` global do `users-service` também consiga validar o
  token na requisição encaminhada.
- `POST /auth/register` e `POST /auth/login` não exigem esse repasse (rotas públicas, sem token de
  entrada).

#### RF8 — Secret JWT compartilhado (pré-requisito do fluxo E2E)
- O token emitido pelo `users-service` no login deve ser aceito pelos guards de autenticação do
  gateway. Para isso, o `JWT_SECRET` usado pelo gateway ao validar tokens e o `JWT_SECRET` usado
  pelo `users-service` ao emitir tokens devem ser **o mesmo valor**.
- Este requisito já está satisfeito hoje (ambos os `.env` usam `dev-only-change-me-please`); esta
  spec exige apenas a **confirmação** de que permanece correto (sem regressão), não uma alteração.

#### RF9 — Repasse fiel de erros `4xx` pela infraestrutura de proxy
- `ProxyService`, `RetryService` e `CircuitBreakerService` devem distinguir uma resposta de erro
  `4xx` do backend (erro de validação/negócio do cliente) de uma falha de infraestrutura (erro
  `5xx`, timeout, erro de rede/conexão).
- Em caso de resposta `4xx` do serviço a jusante:
  - O `ProxyService` deve propagar ao cliente o **mesmo status code** e o **mesmo corpo**
    retornados pelo backend, sem substituí-los por uma mensagem genérica.
  - O `RetryService` **não** deve tentar novamente a requisição — retry é inútil para um erro de
    validação/negócio, já que o resultado seria o mesmo.
  - O `CircuitBreakerService` **não** deve contabilizar a resposta como falha do circuito (não
    deve aproximar o circuito do estado `OPEN`) — apenas erros `5xx`, timeout ou falha de
    rede/conexão contam para o `failureThreshold`.
- Este requisito é o que torna possível, por exemplo, que um `409 Conflict` de e-mail duplicado no
  registro (`users-service`) chegue ao cliente como `409`, e não como o `401 Unauthorized`
  genérico produzido hoje pelo `AuthService` (ver 1.2/1.3).
- Continua fora de escopo qualquer alteração de comportamento para erros `5xx`, timeout ou falha
  de rede: retry, circuit breaker e fallback continuam agindo exatamente como hoje nesses casos.
- É pré-requisito para RF5/RF6: sem essa distinção, mover `/auth/*` para o `ProxyService` faria
  erros de validação (400, 401, 409) passarem a acionar retry e circuit breaker
  indevidamente — uma regressão em relação ao comportamento atual (ainda que hoje o status/corpo
  também já estejam incorretos por outro motivo).

---

## 4. Fluxo completo esperado via gateway (porta 3005)

Todos os passos são feitos contra o gateway (`http://localhost:3005`), nunca diretamente contra o
`users-service`:

1. **`POST /auth/register`** → gateway encaminha via `ProxyService` para `users-service`
   `POST /auth/register` → usuário é registrado; resposta conforme a spec 02.
   - Se o e-mail já existir, o `users-service` responde **409 Conflict**; o gateway repassa esse
     mesmo status e corpo ao cliente (RF9), sem retry e sem afetar o circuit breaker.
2. **`POST /auth/login`** → gateway encaminha via `ProxyService` para `users-service`
   `POST /auth/login` → retorna um token JWT (e demais dados do login); resposta conforme a
   spec 03.
   - Se as credenciais forem inválidas, o `users-service` responde **401 Unauthorized** com sua
     própria mensagem; o gateway repassa esse status e corpo ao cliente (RF9), sem retry e sem
     afetar o circuit breaker.
3. **`GET /users/profile`** (com `Authorization: Bearer <token>`) → gateway valida o token (guard)
   → encaminha para `users-service` `GET /users/profile`, **repassando** o `Authorization` →
   retorna o perfil do usuário autenticado (conforme a spec 05).
4. **`GET /users/sellers`** (com `Authorization: Bearer <token>`) → gateway valida o token →
   encaminha para `users-service` `GET /users/sellers`, repassando o `Authorization` → retorna a
   lista de vendedores ativos (conforme a spec 05).

Em paralelo:
- O health check do gateway, ao consultar `GET {USERS_SERVICE_URL}/health`, recebe **200** com
  `{ status: "ok", service: "users-service" }`, passando a reportar o `users-service` como
  saudável.

---

## 5. Estruturas de dados e respostas esperadas

### 5.1 `GET /auth/validate-token`

Corpo de sucesso (**200 OK**):

| Campo    | Tipo   | Descrição                                            |
| -------- | ------ | ---------------------------------------------------- |
| `userId` | string (UUID) | `id` do usuário autenticado (derivado de `sub`). |
| `email`  | string | E-mail do usuário autenticado.                       |
| `role`   | string (`seller`/`buyer`) | Papel do usuário autenticado.      |

- **401 Unauthorized** — token ausente, malformado, expirado ou com assinatura inválida.

### 5.2 `GET /health`

Corpo de sucesso (**200 OK**):

```
{ "status": "ok", "service": "users-service" }
```

- Sempre público; nunca retorna 401.

### 5.3 `GET /api` (Swagger)

- Página HTML do Swagger UI, acessível sem autenticação, com título "Users Service", versão "1.0"
  e suporte a Bearer Auth.

### 5.4 Erros `4xx` repassados pelo gateway (`/auth/*` e `/users/*`)

- O gateway **não** reformata nem substitui o corpo de um erro `4xx` retornado pelo
  `users-service`: status code e corpo (`message`, `error`, `statusCode`, conforme o formato
  padrão de exceção do NestJS) chegam ao cliente exatamente como o `users-service` os produziu.
- Exemplos:
  - `POST /auth/register` com e-mail duplicado → **409 Conflict** com o corpo de erro do
    `users-service` (não mais **401** com "Registration failed").
  - `POST /auth/login` com credenciais inválidas → **401 Unauthorized** com a mensagem real do
    `users-service` (não mais a mensagem fixa "Invalid login credentials" do gateway).

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva (via `curl`/Postman).

**No `users-service` (acesso direto, porta 3000):**

- [ ] **CA1** — `GET /auth/validate-token` **sem** token retorna **401 Unauthorized**.
- [ ] **CA2** — `GET /auth/validate-token` com token válido retorna **200** com `{ userId, email,
      role }`, cujos valores correspondem ao payload do token (`sub` → `userId`, `email`, `role`).
- [ ] **CA3** — `GET /auth/validate-token` com token inválido/expirado/adulterado retorna
      **401 Unauthorized**.
- [ ] **CA4** — `GET /health` **sem** token retorna **200** com exatamente
      `{ "status": "ok", "service": "users-service" }`.
- [ ] **CA5** — `GET /api` responde com a documentação Swagger (título "Users Service", versão
      "1.0", com opção de Bearer Auth), acessível sem token.

**Via `api-gateway` (fluxo E2E, porta 3005):**

- [ ] **CA6** — `POST /auth/register` no gateway, com dados válidos, registra o usuário no
      `users-service` e retorna a mesma resposta esperada da spec 02.
- [ ] **CA7** — `POST /auth/login` no gateway, com credenciais válidas, retorna um token JWT
      válido (mesma resposta esperada da spec 03).
- [ ] **CA8** — `GET /users/profile` no gateway, com o `Authorization: Bearer <token>` obtido no
      CA7, retorna **200** com o perfil do usuário autenticado.
- [ ] **CA9** — `GET /users/sellers` no gateway, com um token válido, retorna **200** com a lista
      de vendedores ativos (`role = seller` e `status = active`).
- [ ] **CA10** — `GET /users/profile` no gateway **sem** token (ou com token inválido) retorna
      **401 Unauthorized**.
- [ ] **CA11** — O token emitido pelo login (CA7) é aceito tanto pelo gateway quanto pelo
      `users-service` — ou seja, o mesmo token funciona no fluxo do CA8 (confirma o secret JWT
      compartilhado, RF8).
- [ ] **CA12** — Nenhuma resposta dos endpoints de usuário (CA8, CA9) contém o campo `password`.
- [ ] **CA13** — O health check por serviço do gateway passa a reportar o `users-service` como
      saudável (consequência do `GET /health` público, RF2).
- [ ] **CA14** — `POST /auth/register` no gateway com um e-mail já cadastrado retorna
      **409 Conflict**, com o mesmo status code e corpo de erro que o `users-service` retornaria
      diretamente — **não** um `401 Unauthorized` genérico (RF9).
- [ ] **CA15** — `POST /auth/login` no gateway com credenciais inválidas retorna
      **401 Unauthorized** com a mensagem de erro real do `users-service` — **não** a mensagem
      fixa "Invalid login credentials" produzida hoje pelo `AuthService` (RF9).
- [ ] **CA16** — `GET /users/:id` no gateway com um `id` inexistente retorna o mesmo status code e
      corpo que o `users-service` retorna diretamente, sem ser reformatado pelo gateway (RF9).
- [ ] **CA17** — Erros `4xx` consecutivos em `/auth/*` ou `/users/*` **não** abrem o circuit
      breaker do proxy `users` — uma requisição bem-sucedida logo após várias falhas `4xx` não é
      bloqueada por "circuit breaker OPEN" (RF9).
- [ ] **CA18** — O código do gateway não contém mais `AuthController`; todas as rotas `/auth/*` e
      `/users/*` passam pelo `ProxyService` via `UsersController` (RF5, RF6). O `AuthService`
      remanescente não contém mais `login`/`register`/`validateJwtToken` — sua única chamada HTTP
      direta ao `users-service` é `validateSessionToken`, usada pelo `SessionGuard`, que é
      explicitamente fora de escopo desta spec e permanece inalterado.

---

## 7. Pontos de refatoração no `api-gateway`

Observações levantadas na leitura do código atual do gateway, e o que cada uma exige (seção 3
para os requisitos completos).

1. **Rotas `/auth/*` fora do proxy:** `AuthController` → `AuthService` faz `HttpService` direto ao
   `users-service`, contornando circuit breaker/retry/timeout/fallback. Deve ser substituído pela
   extensão do `UsersController` já existente, via `ProxyService` (RF5), com remoção do
   `AuthController` e redução do `AuthService` (RF6).
2. **Erros engolidos:** `login` e `register` no `AuthService` capturam qualquer erro num `catch`
   genérico e relançam `UnauthorizedException` fixo, perdendo o status/corpo reais (ex.: `409`
   vira `401`). Resolvido pela combinação de RF5/RF6 (proxy) com RF9 (passthrough de `4xx`).
3. **Resiliência não diferencia `4xx` de `5xx`:** `RetryService` tenta novamente qualquer erro
   (incluindo `4xx`) e `CircuitBreakerService` conta qualquer erro como falha do circuito — exige
   a distinção introduzida por RF9, que é pré-requisito para RF5/RF6 não introduzirem uma
   regressão (retry/circuit breaker acionados por erro de validação).
4. **`USERS_SERVICE_URL` e `JWT_SECRET` já alinhados:** diferente do que se poderia supor por
   integrações anteriores, a configuração do gateway já lê a variável correta e os secrets já
   coincidem (`dev-only-change-me-please` nos dois `.env`) — apenas confirmar, sem alteração (RF4,
   RF8).
5. **Padrão de referência já disponível:** `UsersController` (rotas `/users/*`) e
   `ProductsController` (rotas `/products/*`) já demonstram o padrão de proxy fino a ser seguido
   para `/auth/*` — não é necessário inventar uma nova estrutura.

---

## 8. Dependências e sequência

Depende das specs [`03 - user-login`](./03%20-%20user-login.md) (emissão do JWT, `JWT_SECRET`,
payload `{ sub, email, role }`), [`04 - route-protection-jwt-guard`](./04%20-%20route-protection-jwt-guard.md)
(`JwtAuthGuard` global, `@Public()`, `req.user`) e
[`05 - users-query-endpoints`](./05%20-%20users-query-endpoints.md) (rotas `/users/*`). Depende
também do padrão de proxy estabelecido pela integração do `products-service` ao gateway
([spec 05 do products-service](../../../products-service/docs/specs/05%20-%20api-gateway-integration.md)),
usado aqui como referência para `ProductsController`/`ProductsModule`.

Não requer novas dependências de runtime — RF1-RF3 do `users-service` já estão implementados
(`@nestjs/swagger` já presente). No gateway, não introduz novas dependências — apenas remoção do
`AuthController`, redução do `AuthService` e extensão de um controller já existente.

Ordem sugerida de implementação (a ser detalhada no plano):
1. `users-service`: confirmar RF1 (`GET /auth/validate-token`), RF2 (`GET /health`) e RF3 (Swagger)
   — já implementados; validar contra CA1-CA5 sem esperar novo código.
2. `api-gateway`: confirmar `USERS_SERVICE_URL` e o secret JWT compartilhado (RF4, RF8 — já
   corretos, apenas validar que não há regressão).
3. `api-gateway`: corrigir `ProxyService`/`RetryService`/`CircuitBreakerService` para repassar
   `4xx` sem retry e sem acionar o circuit breaker (RF9) — pré-requisito para o passo seguinte,
   já que os critérios CA14-CA17 dependem desse comportamento.
4. `api-gateway`: estender o `UsersController` com `/auth/register`, `/auth/login` e
   `/auth/validate-token`, via `ProxyService` (RF5).
5. `api-gateway`: remover `AuthController` e reduzir `AuthService` a `validateSessionToken`,
   preservando `JwtStrategy` e os decorators/DTOs reaproveitados (RF6).
6. Validação E2E via `curl`/Postman (seção 6), incluindo os cenários de erro `4xx`.

Specs futuras (fora do escopo aqui) poderão cobrir: session management no gateway, `RoleGuard`,
refresh tokens/logout e a integração dos demais serviços ao gateway.
