# SPEC: Integração do `users-service` ao `api-gateway` (`GET /auth/validate-token`, `GET /health`, Swagger e fluxo E2E via gateway)

> **Objetivo:** Finalizar a integração ponta a ponta entre o `users-service` (porta 3000) e o
> `api-gateway` (porta 3005), de forma que registro, login e as consultas de usuários funcionem
> quando acessados **através do gateway**, e que o gateway consiga validar tokens e monitorar a
> saúde do `users-service`.
>
> **Escopo desta spec:**
> - No `users-service`: um endpoint protegido de validação de token (`GET /auth/validate-token`),
>   um endpoint público de health check (`GET /health`), e a documentação Swagger/OpenAPI em
>   `/api`.
> - No `api-gateway`: garantir que a configuração (`USERS_SERVICE_URL`, secret JWT compartilhado) e
>   o roteamento de `/auth/*` e `/users/*` para o `users-service` estejam corretos, reaproveitando a
>   infraestrutura de proxy já existente.
> - Um fluxo E2E verificável via `curl`/Postman, passando pelo gateway.
>
> **Fora de escopo:** qualquer alteração no **mecanismo** de proxy do gateway (circuit breaker,
> retry, timeout, fallback) ou nos **guards** de autenticação do gateway — todos permanecem como
> estão. Também estão fora de escopo: session management (`validateSessionToken`, `x-session-token`,
> `SessionGuard`), refresh tokens, logout, `RoleGuard`, novos endpoints de escrita em usuários, e
> paginação. Nenhum código é definido aqui — apenas **o que** deve ser feito.

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
- `main.ts` habilita CORS e `ValidationPipe` global. **Não** há Swagger configurado e **não** há
  endpoint `/health`.
- Serviço roda na porta 3000 (via `PORT`), com `JWT_SECRET` definido no `.env`.

### 1.2 O que já existe no `api-gateway`

- Infraestrutura de proxy resiliente (`ProxyService`) com circuit breaker, retry com backoff,
  timeout e fallback — **funcional e fora do escopo de alteração**.
- Guards de autenticação (JWT via Passport e Session) — **funcionais e fora do escopo de
  alteração**.
- `AuthController` com `POST /auth/login` e `POST /auth/register`, que encaminham para o
  `users-service` via `AuthService`.
- Health check próprio (`/health`) e checagem por serviço, que consulta a saúde de cada serviço
  fazendo `GET {SERVICE_URL}/health`.
- Swagger já configurado em `/api` para o próprio gateway.
- `.env` com `PORT=3005`, `USERS_SERVICE_URL=http://localhost:3000` e `JWT_SECRET`.

### 1.3 Lacunas que impedem o fluxo E2E hoje

Levantadas a partir da leitura do código atual. **Nenhuma delas exige alterar o mecanismo de proxy
ou os guards** — são criações de endpoints (no users-service) e ajustes de configuração/roteamento
(no gateway). Os pontos do gateway estão detalhados na seção 7.

1. O `users-service` não expõe `GET /auth/validate-token`, `GET /health` nem Swagger.
2. O health check do gateway consulta `GET {USERS_SERVICE_URL}/health`, que hoje retorna 404 (rota
   inexistente) — logo, o gateway reporta o `users-service` como indisponível.
3. As rotas `/users/*` **não estão expostas no gateway** (a infraestrutura de proxy existe, mas
   nenhuma rota a utiliza para `/users/*`).
4. Os `JWT_SECRET` do `users-service` e do `api-gateway` **são diferentes** hoje — como o gateway
   valida localmente o token emitido pelo users-service, o secret precisa ser o mesmo nos dois.
5. A variável de ambiente lida pela configuração do gateway e a definida no `.env` precisam ter o
   **mesmo nome** para que `USERS_SERVICE_URL` tenha efeito.
6. O caminho para o qual o gateway encaminha o **login** precisa corresponder exatamente à rota
   real do `users-service` (`POST /auth/login`).

---

## 2. Stack e padrões

- **Framework:** NestJS 11 nos dois serviços (mesmo padrão dos módulos existentes).
- **Documentação:** `@nestjs/swagger` (mesma lib já usada no gateway).
- **Autenticação:** o `GET /auth/validate-token` é uma rota **protegida** pelo `JwtAuthGuard` global
  do users-service (não deve ser `@Public()`); o `GET /health` é **público** (`@Public()`).
- **Integração entre serviços:** o gateway continua sendo o único ponto de entrada externo; o
  `users-service` não precisa conhecer o gateway. A comunicação gateway → users-service usa a
  infraestrutura de proxy **já existente**, sem modificá-la.
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

> As exigências abaixo são de **configuração** e **roteamento**, reaproveitando a infraestrutura
> existente. **Não** devem alterar o mecanismo de proxy (circuit breaker, retry, timeout, fallback)
> nem os guards. Veja a seção 7 para o estado atual observado e os pontos concretos a verificar.

#### RF4 — Configuração de `USERS_SERVICE_URL`
- O `.env` do gateway deve definir `USERS_SERVICE_URL=http://localhost:3000`.
- A configuração do gateway deve efetivamente **ler** essa mesma variável (o nome lido em código e
  o nome definido no `.env` devem coincidir), de modo que a URL do `users-service` venha da variável
  de ambiente e não apenas de um valor padrão.

#### RF5 — Roteamento de `/auth/*` e `/users/*` para o `users-service`
- Requisições recebidas pelo gateway em `/auth/register` e `/auth/login` devem ser encaminhadas ao
  `users-service` nas rotas reais correspondentes (`POST /auth/register` e `POST /auth/login`).
- Requisições recebidas pelo gateway em `/users/profile`, `/users/sellers` e `/users/:id` devem ser
  encaminhadas ao `users-service` nas rotas correspondentes, utilizando a infraestrutura de proxy
  **já existente** (com seu circuit breaker/retry/timeout), sem alterá-la.
- O caminho encaminhado a jusante deve corresponder exatamente à rota real do `users-service`
  (mesmos prefixos e segmentos), de modo que o `users-service` reconheça a requisição.

#### RF6 — Repasse do header `Authorization`
- Nas requisições encaminhadas para rotas protegidas do `users-service` (`/users/*` e
  `/auth/validate-token`), o gateway deve **repassar** o header `Authorization` recebido do cliente.
- Isso é necessário para que o `JwtAuthGuard` global do `users-service` também consiga validar o
  token na requisição encaminhada.

#### RF7 — Secret JWT compartilhado (pré-requisito do fluxo E2E)
- O token emitido pelo `users-service` no login deve ser aceito pelos guards de autenticação do
  gateway. Para isso, o `JWT_SECRET` usado pelo gateway ao validar tokens e o `JWT_SECRET` usado
  pelo `users-service` ao emitir tokens devem ser **o mesmo valor**.
- Este é um requisito de **configuração** (alinhar o valor da variável de ambiente nos dois
  serviços), não uma alteração do mecanismo de guards.

---

## 4. Fluxo completo esperado via gateway (porta 3005)

Todos os passos são feitos contra o gateway (`http://localhost:3005`), nunca diretamente contra o
`users-service`:

1. **`POST /auth/register`** → gateway encaminha para `users-service` `POST /auth/register` →
   usuário é registrado; resposta conforme a spec 02.
2. **`POST /auth/login`** → gateway encaminha para `users-service` `POST /auth/login` → retorna um
   token JWT (e demais dados do login); resposta conforme a spec 03.
3. **`GET /users/profile`** (com `Authorization: Bearer <token>`) → gateway valida o token (guard) →
   encaminha para `users-service` `GET /users/profile`, **repassando** o `Authorization` → retorna o
   perfil do usuário autenticado (conforme a spec 05).
4. **`GET /users/sellers`** (com `Authorization: Bearer <token>`) → gateway valida o token →
   encaminha para `users-service` `GET /users/sellers`, repassando o `Authorization` → retorna a
   lista de vendedores ativos (conforme a spec 05).

Em paralelo:
- O health check do gateway, ao consultar `GET {USERS_SERVICE_URL}/health`, recebe **200** com
  `{ status: "ok", service: "users-service" }`, passando a reportar o `users-service` como saudável.

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

- [ ] **CA6** — `POST /auth/register` no gateway registra o usuário no `users-service` (mesma
      resposta esperada da spec 02).
- [ ] **CA7** — `POST /auth/login` no gateway retorna um token JWT válido (mesma resposta esperada
      da spec 03).
- [ ] **CA8** — `GET /users/profile` no gateway, com o `Authorization: Bearer <token>` obtido no
      CA7, retorna **200** com o perfil do usuário autenticado.
- [ ] **CA9** — `GET /users/sellers` no gateway, com um token válido, retorna **200** com a lista de
      vendedores ativos (`role = seller` e `status = active`).
- [ ] **CA10** — `GET /users/profile` no gateway **sem** token (ou com token inválido) retorna
      **401 Unauthorized**.
- [ ] **CA11** — O token emitido pelo login (CA7) é aceito tanto pelo gateway quanto pelo
      `users-service` — ou seja, o mesmo token funciona no fluxo do CA8 (confirma o secret JWT
      compartilhado, RF7).
- [ ] **CA12** — Nenhuma resposta dos endpoints de usuário (CA8, CA9) contém o campo `password`.
- [ ] **CA13** — O health check por serviço do gateway passa a reportar o `users-service` como
      saudável (consequência do `GET /health` público, RF2).

---

## 7. Estado atual do `api-gateway` e pontos a verificar

Observações levantadas na leitura do código atual do gateway. Servem de insumo para o **plano de
implementação**; a resolução de cada ponto deve ocorrer **sem** alterar o mecanismo de proxy
(circuit breaker/retry/timeout/fallback) nem os guards — apenas configuração e roteamento.

1. **Roteamento de `/users/*` inexistente:** a infraestrutura de proxy (`ProxyService`) existe e
   está pronta, mas **nenhuma rota do gateway** encaminha `/users/*` para o `users-service` hoje.
   Para os critérios CA8/CA9, é necessário expor essas rotas **usando o proxy já existente**.
2. **Caminho do login:** o encaminhamento de `register` aponta para `/auth/register` (correto), mas
   o de `login` precisa apontar para `/auth/login` (a rota real do users-service) — verificar e
   alinhar (RF5).
3. **Nome da variável de ambiente:** confirmar que o nome lido pela configuração do gateway
   coincide com `USERS_SERVICE_URL` do `.env`; caso contrário, a variável do `.env` é ignorada e só
   o valor padrão vale (RF4).
4. **Secret JWT divergente:** hoje o `JWT_SECRET` do gateway e o do `users-service` têm valores
   diferentes; precisam ser iguais para o token do login ser aceito pelos guards do gateway (RF7).
5. **Repasse do `Authorization`:** confirmar que, no caminho de proxy usado para `/users/*`, o
   header `Authorization` recebido do cliente é repassado ao `users-service` (RF6).

---

## 8. Dependências e sequência

Depende das specs [`03 - user-login`](./03%20-%20user-login.md) (emissão do JWT, `JWT_SECRET`,
payload `{ sub, email, role }`), [`04 - route-protection-jwt-guard`](./04%20-%20route-protection-jwt-guard.md)
(`JwtAuthGuard` global, `@Public()`, `req.user`) e
[`05 - users-query-endpoints`](./05%20-%20users-query-endpoints.md) (rotas `/users/*`).

Não requer novas dependências de runtime no `users-service` além do `@nestjs/swagger` (para RF3),
caso ainda não esteja presente. No gateway, não introduz novas dependências.

Ordem sugerida de implementação (a ser detalhada no plano):
1. `users-service`: `GET /health` público (RF2) — desbloqueia o health check do gateway.
2. `users-service`: `GET /auth/validate-token` (RF1).
3. `users-service`: Swagger em `/api` (RF3).
4. `api-gateway`: alinhar `USERS_SERVICE_URL` e o secret JWT compartilhado (RF4, RF7).
5. `api-gateway`: expor/validar o roteamento de `/auth/*` e `/users/*` e o repasse do
   `Authorization` (RF5, RF6), reutilizando a infraestrutura de proxy existente.
6. Validação E2E via `curl`/Postman (seção 6).

Specs futuras (fora do escopo aqui) poderão cobrir: session management no gateway, `RoleGuard`,
refresh tokens/logout e a integração dos demais serviços ao gateway.
