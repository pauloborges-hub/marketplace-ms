# SPEC: Proteção de rotas com JWT (`JwtStrategy` + `JwtAuthGuard` + `@Public()`)

> **Objetivo:** Proteger, por padrão, todas as rotas do `users-service` exigindo um token JWT
> válido, permitindo marcar explicitamente como públicas as rotas que não precisam de
> autenticação (`POST /auth/register` e `POST /auth/login`).
>
> **Escopo desta spec:** estratégia Passport de validação de JWT, guard global de autenticação,
> decorator para marcar rotas públicas, e aplicação desse decorator nas rotas existentes de
> `auth`.
> **Fora de escopo:** controle de acesso por papel/role (`RoleGuard`), guard de sessão
> (`SessionGuard`), refresh tokens, logout, criação de novos endpoints, e qualquer alteração no
> fluxo de emissão do token feito em [`03 - user-login`](./03%20-%20user-login.md). Tudo isso
> será tratado em specs futuras.

---

## 1. Contexto

Esta é a quarta spec do `users-service`, na sequência de [`02 - user-registration`](./02%20-%20user-registration.md) e [`03 - user-login`](./03%20-%20user-login.md). O que já existe hoje:

- `AuthModule`, com `AuthController` e `AuthService`, importado pelo `AppModule`.
- `POST /auth/register` e `POST /auth/login` funcionando, este último emitindo um JWT assinado com payload `{ sub, email, role }`.
- `JwtModule` já configurado (via `registerAsync`) no `AuthModule`, lendo o secret de `JWT_SECRET` e com expiração de 24 horas.
- Dependências `@nestjs/passport`, `passport` e `passport-jwt` já instaladas (ainda não utilizadas).
- `ValidationPipe` global habilitado.
- Nenhuma rota atualmente exige autenticação — todas são acessíveis sem token.

Esta spec adiciona a camada de autorização: a partir dela, toda rota do serviço passa a exigir um JWT válido, exceto as que forem explicitamente marcadas como públicas.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos módulos existentes).
- **Estratégia de autenticação:** `passport-jwt`, integrada via `@nestjs/passport`.
- **Guard global:** registrado via token `APP_GUARD` do NestJS, aplicado automaticamente a todas as rotas do serviço (não apenas às do `AuthModule`).
- **Metadata de rota:** mecanismo nativo do NestJS (`Reflector` + decorators customizados) para marcar rotas como públicas — sem libs adicionais.
- **Configuração:** o secret do JWT continua vindo exclusivamente de `JWT_SECRET` (mesma variável já usada na emissão do token); nenhuma nova variável de ambiente é introduzida por esta spec.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário para esta spec.

---

## 3. Requisitos funcionais

### RF1 — Estratégia de validação de token (`JwtStrategy`)
- O sistema deve validar tokens JWT recebidos no header `Authorization`, no formato `Bearer <token>`.
- A extração do token do header deve ser automática, sem exigir que cada endpoint implemente essa lógica manualmente.
- A assinatura do token deve ser validada contra o secret configurado em `JWT_SECRET`.
- A expiração do token (`exp`) deve ser validada automaticamente; um token expirado deve ser tratado como inválido.
- Um token com assinatura inválida (adulterado ou assinado com outro secret) deve ser tratado como inválido.
- A partir de um token válido, o sistema deve extrair do payload os campos `sub`, `email` e `role` e disponibilizá-los como um objeto de usuário autenticado.
- Esse objeto de usuário autenticado deve conter, no mínimo, os campos `id` (a partir de `sub`), `email` e `role`.
- Esse objeto deve ficar disponível para o controller e para código downstream através da requisição (`req.user`), em qualquer rota protegida.
- A estratégia não deve fazer nenhuma consulta ao banco de dados para validar o token — a validação é feita inteiramente a partir da assinatura e do payload do próprio JWT.

### RF2 — Marcação de rotas públicas (`@Public()`)
- O sistema deve fornecer um mecanismo (decorator) para marcar uma rota (ou um controller inteiro) como pública, ou seja, não exigindo autenticação.
- Essa marcação deve ser feita através de metadata associada à rota, seguindo o mecanismo nativo do NestJS para esse tipo de anotação.
- A ausência dessa marcação em uma rota implica, por padrão, que ela exige autenticação.

### RF3 — Guard global de autenticação (`JwtAuthGuard`)
- O sistema deve aplicar verificação de autenticação a **todas** as rotas do serviço, de forma automática e centralizada, sem exigir que cada controller ou rota aplique um guard manualmente.
- Para cada requisição, o guard deve primeiro verificar se a rota (ou o handler) está marcada como pública (RF2).
  - Se a rota for pública, a requisição deve prosseguir normalmente, sem exigir nem validar token algum.
  - Se a rota não for pública, o guard deve exigir um token JWT válido, delegando a validação à estratégia descrita em RF1.
- Se a validação do token falhar (token ausente, expirado, malformado ou com assinatura inválida) em uma rota não pública, a requisição deve ser rejeitada antes de chegar ao controller.
- Se a validação do token for bem-sucedida, os dados do usuário autenticado (RF1) devem estar disponíveis para o controller antes da execução do handler.

### RF4 — Rotas públicas existentes
- A rota `POST /auth/register` deve ser marcada como pública, mantendo o comportamento atual (acessível sem token).
- A rota `POST /auth/login` deve ser marcada como pública, mantendo o comportamento atual (acessível sem token).
- Nenhuma outra rota do serviço deve ser marcada como pública por esta spec — como não há outros endpoints protegidos além de `auth` no momento, o efeito prático desta spec é: `register` e `login` continuam abertos, e qualquer rota futura passa a exigir token por padrão, a menos que explicitamente marcada como pública.

---

## 4. Fluxo esperado de uma requisição

1. A requisição chega a um endpoint qualquer do `users-service`.
2. O `JwtAuthGuard` (global) intercepta a requisição antes de qualquer controller.
3. O guard verifica, via metadata, se a rota (ou handler) foi marcada com `@Public()`.
   - **Se sim:** a requisição segue direto para o controller, sem checagem de token.
   - **Se não:** o guard aciona a validação de token (RF1):
     a. Extrai o token do header `Authorization` (formato `Bearer <token>`).
     b. Se o header estiver ausente ou não seguir o formato esperado, a requisição é rejeitada.
     c. Se o token estiver presente, sua assinatura e expiração são validadas.
     d. Se a validação falhar (por qualquer motivo), a requisição é rejeitada.
     e. Se a validação for bem-sucedida, os dados do usuário (`id`, `email`, `role`) são anexados à requisição (`req.user`).
4. Apenas requisições que passaram pela verificação (públicas, ou autenticadas com sucesso) chegam ao controller correspondente.

---

## 5. Respostas esperadas

### Rotas públicas (`POST /auth/register`, `POST /auth/login`)
- Comportamento inalterado em relação às specs [`02`](./02%20-%20user-registration.md) e [`03`](./03%20-%20user-login.md): acessíveis sem qualquer token, mesmas respostas de sucesso e erro já definidas.

### Rotas protegidas (qualquer rota não marcada como `@Public()`)

- **401 Unauthorized**, quando:
  - O header `Authorization` está ausente.
  - O header `Authorization` está presente mas não segue o formato `Bearer <token>`.
  - O token está presente mas expirado.
  - O token está presente mas com assinatura inválida (adulterado ou assinado com secret diferente do configurado).
  - O token está malformado (não é um JWT válido).
- **Resposta normal do handler**, quando o token é válido — o controller é executado normalmente e `req.user` contém os dados do usuário autenticado (`id`, `email`, `role`).
- Em nenhum cenário de erro (401) o handler da rota deve ser executado.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Uma requisição a `POST /auth/register` sem header `Authorization` retorna o comportamento normal da spec 02 (não retorna 401 por falta de token).
- [ ] **CA2** — Uma requisição a `POST /auth/login` sem header `Authorization` retorna o comportamento normal da spec 03 (não retorna 401 por falta de token).
- [ ] **CA3** — Uma requisição a uma rota protegida (qualquer rota não marcada com `@Public()`) sem header `Authorization` retorna **401 Unauthorized**.
- [ ] **CA4** — Uma requisição a uma rota protegida com header `Authorization` presente mas fora do formato `Bearer <token>` retorna **401 Unauthorized**.
- [ ] **CA5** — Uma requisição a uma rota protegida com um token expirado retorna **401 Unauthorized**.
- [ ] **CA6** — Uma requisição a uma rota protegida com um token assinado com um secret diferente do configurado em `JWT_SECRET` retorna **401 Unauthorized**.
- [ ] **CA7** — Uma requisição a uma rota protegida com um token malformado (string qualquer que não seja um JWT válido) retorna **401 Unauthorized**.
- [ ] **CA8** — Uma requisição a uma rota protegida com um token válido (assinatura e expiração corretas, emitido por `POST /auth/login`) é processada normalmente pelo controller, sem retornar 401.
- [ ] **CA9** — No cenário do CA8, o objeto disponível em `req.user` contém `id`, `email` e `role`, com valores correspondentes ao payload do token (`sub`, `email`, `role` respectivamente).
- [ ] **CA10** — O guard de autenticação é aplicado globalmente: uma rota nova, criada sem nenhuma anotação especial, exige token por padrão (comportamento verificável através de uma rota de teste temporária ou de inspeção da configuração do `APP_GUARD`).
- [ ] **CA11** — Nenhum critério desta spec depende de consulta ao banco de dados para validar o token — a validação é feita inteiramente a partir do JWT.

---

## 7. Dependências e sequência

Depende da spec [`03 - user-login`](./03%20-%20user-login.md) (emissão do JWT, configuração do `JwtModule`, secret `JWT_SECRET`, payload `{ sub, email, role }`).

Não requer novas dependências de runtime — `@nestjs/passport`, `passport` e `passport-jwt` já estão instaladas; nenhuma nova variável de ambiente é introduzida.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. Controle de acesso por papel (`RoleGuard`), usando o campo `role` já disponível em `req.user`.
2. Refresh tokens / renovação de sessão.
3. Integração da autenticação com o `api-gateway`.
