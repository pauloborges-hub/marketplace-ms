# SPEC: Autenticação JWT no `products-service` (`JwtStrategy` + `JwtAuthGuard` + `@Public()`)

> **Objetivo:** Proteger, por padrão, todas as rotas do `products-service` exigindo um token JWT
> válido — emitido pelo `users-service` —, reproduzindo no `products-service` o mesmo mecanismo de
> autenticação já validado no `users-service`.
>
> **Escopo desta spec:** instalação das dependências de autenticação, estratégia Passport de
> validação de JWT, guard global de autenticação, e decorator para marcar rotas públicas.
> **Fora de escopo:** qualquer endpoint de `login`/`register` (essa responsabilidade é exclusiva
> do `users-service`), controle de acesso por papel/role (`RoleGuard`), refresh tokens, emissão ou
> assinatura de tokens, e integração com o `api-gateway`. Tudo isso está fora do escopo desta spec
> ou será tratado em specs futuras.

---

## 1. Contexto

Esta é a segunda spec do `products-service`, na sequência de [`01 - scaffold`](./01%20-%20scaffold.md). O que já existe hoje:

- Scaffold NestJS funcional, com `AppModule`, `ProductsModule` (sem controllers/rotas ainda) e a entidade `Product`.
- `ConfigModule` global já configurado, lendo variáveis de ambiente do `.env`.
- `ValidationPipe` global habilitado.
- Nenhuma dependência de autenticação instalada ainda (`@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`).
- Nenhuma rota de negócio exposta além do endpoint padrão gerado pelo scaffold do NestJS (`AppController`).

O `users-service` (porta 3000) já possui um fluxo de `login` funcional e emite tokens JWT assinados com o payload `{ sub: UUID, email: string, role: "seller" | "buyer" }`, usando um secret configurado em `JWT_SECRET`. O `products-service` (porta 3001) **não** realiza login nem registro — ele é um consumidor desse token: precisa apenas validar, em cada requisição, que o token foi emitido pelo `users-service` (mesma assinatura) e que ainda é válido (não expirado).

Esta spec adiciona ao `products-service` a mesma camada de autorização já implementada no `users-service` (spec [`04 - route-protection-jwt-guard`](../../users-service/docs/specs/04%20-%20route-protection-jwt-guard.md) daquele serviço), reaproveitando exatamente a mesma abordagem: a partir dela, toda rota do `products-service` passa a exigir um JWT válido, exceto as que forem explicitamente marcadas como públicas.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos demais serviços do monorepo).
- **Estratégia de autenticação:** `passport-jwt`, integrada via `@nestjs/passport`.
- **Dependências novas:** `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` (e o respectivo pacote de tipos `@types/passport-jwt` como dependência de desenvolvimento) — nenhuma dessas está instalada hoje no `products-service`.
- **Guard global:** registrado via token `APP_GUARD` do NestJS, aplicado automaticamente a todas as rotas do serviço.
- **Metadata de rota:** mecanismo nativo do NestJS (`Reflector` + decorator customizado) para marcar rotas como públicas — sem libs adicionais.
- **Secret compartilhado:** o `products-service` **não gera** o secret — ele deve usar exatamente o mesmo valor de `JWT_SECRET` já configurado no `users-service`, lido a partir de variável de ambiente própria do `products-service`.
- **Paridade de implementação:** a estrutura de pastas, nomes de classes e organização do código devem seguir o mesmo padrão usado no `AuthModule` do `users-service` (estratégia, guard e decorator organizados em subpastas dedicadas), adaptado ao fato de que o `products-service` não possui `AuthController` nem `AuthService`.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário para esta spec.

---

## 3. Requisitos funcionais

### RF1 — Instalação das dependências de autenticação
- O `products-service` deve passar a declarar como dependências de runtime: `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt`.
- O pacote de tipos `@types/passport-jwt` deve ser adicionado como dependência de desenvolvimento.
- Nenhuma outra dependência relacionada a autenticação deve ser adicionada (sem bibliotecas de sessão, OAuth, etc.).

### RF2 — Estratégia de validação de token (`JwtStrategy`)
- O sistema deve validar tokens JWT recebidos no header `Authorization`, no formato `Bearer <token>`.
- A extração do token do header deve ser automática, sem exigir que cada endpoint implemente essa lógica manualmente.
- A assinatura do token deve ser validada contra o mesmo secret usado pelo `users-service` para assinar o token, configurado no `products-service` através de variável de ambiente própria (ver RF6).
- A expiração do token (`exp`) deve ser validada automaticamente; um token expirado deve ser tratado como inválido.
- Um token com assinatura inválida (adulterado ou assinado com secret diferente) deve ser tratado como inválido.
- A partir de um token válido, o sistema deve extrair do payload os campos `sub`, `email` e `role`, e disponibilizá-los como um objeto de usuário autenticado.
- Esse objeto de usuário autenticado deve conter, no mínimo, os campos `id` (a partir de `sub`), `email` e `role`.
- Esse objeto deve ficar disponível para o controller e para código downstream através da requisição (`req.user`), em qualquer rota protegida.
- A estratégia não deve fazer nenhuma consulta a banco de dados (nem ao banco do `products-service`, nem — via chamada remota — ao `users-service`) para validar o token; a validação é feita inteiramente a partir da assinatura e do payload do próprio JWT.
- O `products-service` não deve, em nenhum momento, gerar, assinar ou reemitir tokens — apenas validar tokens já emitidos pelo `users-service`.

### RF3 — Marcação de rotas públicas (`@Public()`)
- O sistema deve fornecer um mecanismo (decorator) para marcar uma rota (ou um controller inteiro) como pública, ou seja, não exigindo autenticação.
- Essa marcação deve ser feita através de metadata associada à rota, seguindo o mecanismo nativo do NestJS para esse tipo de anotação.
- A ausência dessa marcação em uma rota implica, por padrão, que ela exige autenticação.

### RF4 — Guard global de autenticação (`JwtAuthGuard`)
- O sistema deve aplicar verificação de autenticação a **todas** as rotas do serviço, de forma automática e centralizada, sem exigir que cada controller ou rota aplique um guard manualmente.
- Para cada requisição, o guard deve primeiro verificar se a rota (ou o handler) está marcada como pública (RF3).
  - Se a rota for pública, a requisição deve prosseguir normalmente, sem exigir nem validar token algum.
  - Se a rota não for pública, o guard deve exigir um token JWT válido, delegando a validação à estratégia descrita em RF2.
- Se a validação do token falhar (token ausente, expirado, malformado ou com assinatura inválida) em uma rota não pública, a requisição deve ser rejeitada antes de chegar ao controller.
- Se a validação do token for bem-sucedida, os dados do usuário autenticado (RF2) devem estar disponíveis para o controller antes da execução do handler.

### RF5 — Módulo de autenticação (`AuthModule`)
- Deve existir um `AuthModule` dedicado, responsável por registrar `JwtStrategy` e disponibilizar o `JwtAuthGuard` como guard global (via `APP_GUARD`).
- O `AuthModule` deve ser importado pelo `AppModule`.
- O `AuthModule` **não** deve conter `AuthController`, `AuthService` nem qualquer endpoint — sua única responsabilidade é a validação de tokens e a proteção de rotas.

### RF6 — Variável de ambiente do secret compartilhado
- Deve existir uma variável de ambiente `JWT_SECRET` no `products-service`, adicionada ao `.env` e ao `.env.example`.
- O valor dessa variável, em ambiente de desenvolvimento, deve ser **idêntico** ao valor configurado em `JWT_SECRET` no `users-service` — caso contrário, nenhum token emitido pelo `users-service` será validado com sucesso pelo `products-service`.
- Nenhuma outra variável de ambiente relacionada a autenticação (ex.: tempo de expiração para assinatura) é necessária nesta spec, já que o `products-service` não assina tokens.

### RF7 — Rotas existentes do scaffold
- A rota padrão gerada pelo scaffold do NestJS (`AppController`) não deve ser marcada como pública — ela passa a exigir token válido como qualquer outra rota, servindo como demonstração de que o guard global está ativo por padrão.

---

## 4. Fluxo esperado de uma requisição

1. A requisição chega a um endpoint qualquer do `products-service`.
2. O `JwtAuthGuard` (global) intercepta a requisição antes de qualquer controller.
3. O guard verifica, via metadata, se a rota (ou handler) foi marcada com `@Public()`.
   - **Se sim:** a requisição segue direto para o controller, sem checagem de token.
   - **Se não:** o guard aciona a validação de token (RF2):
     a. Extrai o token do header `Authorization` (formato `Bearer <token>`).
     b. Se o header estiver ausente ou não seguir o formato esperado, a requisição é rejeitada.
     c. Se o token estiver presente, sua assinatura (contra o `JWT_SECRET` do `products-service`) e expiração são validadas.
     d. Se a validação falhar (por qualquer motivo), a requisição é rejeitada.
     e. Se a validação for bem-sucedida, os dados do usuário (`id`, `email`, `role`) são anexados à requisição (`req.user`).
4. Apenas requisições que passaram pela verificação (públicas, ou autenticadas com sucesso) chegam ao controller correspondente.

---

## 5. Respostas esperadas

### Rotas marcadas como públicas
- Acessíveis sem qualquer token, com a resposta normal do handler correspondente.

### Rotas protegidas (qualquer rota não marcada como `@Public()`, incluindo a rota padrão do scaffold)

- **401 Unauthorized**, quando:
  - O header `Authorization` está ausente.
  - O header `Authorization` está presente mas não segue o formato `Bearer <token>`.
  - O token está presente mas expirado.
  - O token está presente mas com assinatura inválida (adulterado, ou assinado com um secret diferente do configurado em `JWT_SECRET` no `products-service`).
  - O token está malformado (não é um JWT válido).
- **Resposta normal do handler**, quando o token é válido — o controller é executado normalmente e `req.user` contém os dados do usuário autenticado (`id`, `email`, `role`).
- Em nenhum cenário de erro (401) o handler da rota deve ser executado.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — `npm install` na pasta `products-service` conclui sem erros e instala `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` como dependências de runtime, e `@types/passport-jwt` como dependência de desenvolvimento.
- [ ] **CA2** — A variável `JWT_SECRET` está documentada no `.env.example` do `products-service` e presente no `.env` local, com o mesmo valor usado pelo `users-service`.
- [ ] **CA3** — Uma requisição a uma rota protegida do `products-service` (incluindo a rota padrão do scaffold) sem header `Authorization` retorna **401 Unauthorized**.
- [ ] **CA4** — Uma requisição a uma rota protegida com header `Authorization` presente mas fora do formato `Bearer <token>` retorna **401 Unauthorized**.
- [ ] **CA5** — Uma requisição a uma rota protegida com um token expirado retorna **401 Unauthorized**.
- [ ] **CA6** — Uma requisição a uma rota protegida com um token assinado com um secret diferente do configurado em `JWT_SECRET` retorna **401 Unauthorized**.
- [ ] **CA7** — Uma requisição a uma rota protegida com um token malformado (string qualquer que não seja um JWT válido) retorna **401 Unauthorized**.
- [ ] **CA8** — Um token **válido, obtido através do `POST /auth/login` do `users-service`**, é aceito pelo `products-service`: uma requisição a uma rota protegida com esse token no header `Authorization` é processada normalmente, sem retornar 401 — comprovando que os dois serviços compartilham o mesmo secret.
- [ ] **CA9** — No cenário do CA8, o objeto disponível em `req.user` contém `id`, `email` e `role`, com valores correspondentes ao payload do token (`sub`, `email`, `role` respectivamente).
- [ ] **CA10** — Uma rota marcada explicitamente com `@Public()` é acessível sem token, mesmo com o guard global ativo.
- [ ] **CA11** — O guard de autenticação é aplicado globalmente: qualquer rota nova, criada sem nenhuma anotação especial, exige token por padrão.
- [ ] **CA12** — Nenhum critério desta spec depende de consulta a banco de dados (do `products-service` ou do `users-service`) para validar o token — a validação é feita inteiramente a partir do JWT.
- [ ] **CA13** — O `products-service` não expõe nenhum endpoint de `login`, `register` ou qualquer outra rota de emissão de token.
- [ ] **CA14** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Depende da spec [`01 - scaffold`](./01%20-%20scaffold.md) deste serviço (estrutura do projeto, `ConfigModule`, `.env`) e, externamente, do fluxo de login já implementado no `users-service` (specs [`03 - user-login`](../../users-service/docs/specs/03%20-%20user-login.md) e [`04 - route-protection-jwt-guard`](../../users-service/docs/specs/04%20-%20route-protection-jwt-guard.md)), de onde vêm o formato do payload (`sub`, `email`, `role`) e o valor de `JWT_SECRET` a ser replicado.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. CRUD de produtos (endpoints REST + DTOs + service), já protegidos por padrão graças a esta spec.
2. Controle de acesso por papel (`RoleGuard` ou verificação manual de `role` nos controllers/services), usando o campo `role` já disponível em `req.user`.
3. Integração do `products-service` com o `api-gateway`.
