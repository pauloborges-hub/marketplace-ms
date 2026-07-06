# SPEC: Registro de usuário (`POST /auth/register`)

> **Objetivo:** Permitir o cadastro de novos usuários (sellers e buyers) no `users-service`,
> com senha armazenada de forma segura (hash) e validação completa dos dados de entrada.
>
> **Escopo desta spec:** módulo de autenticação (`AuthModule`), endpoint de registro e regras de negócio associadas.
> **Fora de escopo:** login, emissão/validação de JWT, recuperação de senha, qualquer outro endpoint de `auth` ou de `users`. Tudo isso será tratado em specs futuras.

---

## 1. Contexto

Esta é a segunda spec do `users-service`, na sequência de [`01 - scaffold`](./01%20-%20scaffold.md). O scaffold já entrega:

- Projeto NestJS configurado, com TypeORM + PostgreSQL.
- A entidade `User` (`id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`), com `role` e `status` como enums (`seller`/`buyer` e `active`/`inactive`).
- `UsersModule` registrando a entidade no TypeORM, sem controller nem lógica de negócio.
- `ValidationPipe` global habilitado (`transform`, `whitelist`, `forbidNonWhitelisted`).

Esta spec adiciona a primeira funcionalidade real do serviço: o cadastro de um novo usuário via API.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos módulos existentes).
- **ORM:** TypeORM, via repositório da entidade `User` já registrada no `UsersModule`.
- **Hash de senha:** `bcryptjs`, com **10 salt rounds**.
- **Validação:** `class-validator` + `class-transformer` (já configurados globalmente).
- O projeto deve continuar **enxuto** — sem dependências ou abstrações além do necessário para esta spec.

---

## 3. Requisitos funcionais

### RF1 — Módulo de autenticação (`AuthModule`)
- Deve existir um módulo dedicado, `AuthModule`, responsável pela lógica de registro (e, em specs futuras, login).
- O módulo deve conter um controller (`AuthController`) e um service (`AuthService`) próprios, separados do `UsersModule`.
- O `AuthModule` deve importar o `UsersModule` para ter acesso ao repositório da entidade `User` (sem duplicar acesso a dados fora do domínio de usuários).
- O `AuthModule` deve ser importado pelo `AppModule`.

### RF2 — Endpoint `POST /auth/register`
- Deve expor a rota `POST /auth/register`, que recebe os dados de um novo usuário no corpo da requisição.
- A responsabilidade de orquestrar o cadastro (validar unicidade de e-mail, gerar hash de senha, definir status e persistir) pertence ao `AuthService`; o controller apenas recebe a requisição e delega.

### RF3 — Verificação de e-mail duplicado
- Antes de criar o usuário, o sistema deve verificar se já existe um usuário cadastrado com o mesmo e-mail (busca exata, sem diferenciar maiúsculas/minúsculas deve ser considerado o mesmo e-mail — ex.: `Foo@Bar.com` e `foo@bar.com` são o mesmo e-mail).
- Se já existir um usuário com o e-mail informado, o cadastro deve ser rejeitado com **409 Conflict**, sem alterar nenhum dado existente e sem tentar inserir o novo registro.
- Se não existir, o fluxo de criação segue normalmente.

### RF4 — Hash da senha
- A senha recebida em texto plano nunca deve ser persistida nem retornada.
- Antes de salvar o usuário, a senha deve ser transformada em hash usando `bcrypt`, com **10 salt rounds**.
- Apenas o hash resultante deve ser armazenado no campo `password` da entidade `User`.

### RF5 — Status inicial do usuário
- Todo usuário criado por este endpoint deve receber automaticamente o status `active`.
- O valor de `status` não deve ser aceito como entrada do cliente neste endpoint (não faz parte do DTO de criação).

### RF6 — Omissão da senha na resposta
- Em nenhuma circunstância a resposta da API (sucesso ou erro) deve conter o campo `password` ou seu hash.
- O usuário retornado na resposta de sucesso deve conter apenas: `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`.

### RF7 — Validação dos dados de entrada
- Todos os campos do DTO de criação (seção 4) devem ser validados antes de qualquer acesso ao banco.
- Requisições com dados inválidos devem ser rejeitadas com **400 Bad Request**, sem chegar a consultar ou alterar o banco.
- As mensagens de erro de validação devem ser claras e identificar o campo e a regra violada (ex.: "email must be a valid email", "password must be longer than or equal to 6 characters"), aproveitando as mensagens padrão do `class-validator` ou mensagens customizadas equivalentes.
- Campos não previstos no DTO enviados pelo cliente devem ser descartados (comportamento já garantido pelo `whitelist: true` do `ValidationPipe` global) — e, com `forbidNonWhitelisted: true`, essa tentativa deve resultar em erro 400.

---

## 4. Estrutura de dados

### 4.1 DTO de entrada — `RegisterDto` (corpo de `POST /auth/register`)

| Campo       | Tipo   | Regras                                                                 |
| ----------- | ------ | ----------------------------------------------------------------------- |
| `email`     | string | Obrigatório. Deve ser um e-mail válido.                                 |
| `password`  | string | Obrigatório. Mínimo de **6 caracteres**.                                |
| `firstName` | string | Obrigatório. Máximo de **100 caracteres**.                              |
| `lastName`  | string | Obrigatório. Máximo de **100 caracteres**.                              |
| `role`      | enum   | Obrigatório. Deve ser exatamente `seller` ou `buyer`.                   |

- Nenhum outro campo é aceito neste DTO (em particular, `status` e `id` não podem ser informados pelo cliente).

### 4.2 Dados persistidos — entidade `User`

O registro criado no banco usa a entidade `User` já existente (spec 01), preenchida da seguinte forma a partir do `RegisterDto`:

| Campo       | Origem                                                        |
| ----------- | -------------------------------------------------------------- |
| `id`        | Gerado automaticamente pelo banco.                              |
| `email`     | Valor informado no DTO.                                        |
| `password`  | Hash bcrypt (10 salt rounds) da senha informada no DTO.         |
| `firstName` | Valor informado no DTO.                                        |
| `lastName`  | Valor informado no DTO.                                        |
| `role`      | Valor informado no DTO.                                        |
| `status`    | Sempre `active`, definido pelo sistema (não vem do DTO).        |
| `createdAt` | Preenchido automaticamente na criação.                          |
| `updatedAt` | Preenchido automaticamente na criação.                          |

### 4.3 DTO de saída — resposta de sucesso

Representa o usuário criado, **sem** o campo `password`:

| Campo       | Tipo             |
| ----------- | ---------------- |
| `id`        | string (UUID)     |
| `email`     | string            |
| `firstName` | string            |
| `lastName`  | string            |
| `role`      | enum (`seller`/`buyer`) |
| `status`    | enum (`active`/`inactive`) |
| `createdAt` | timestamp (ISO 8601) |
| `updatedAt` | timestamp (ISO 8601) |

---

## 5. Respostas esperadas

### 201 Created
- Cadastro realizado com sucesso.
- Corpo da resposta: objeto do usuário conforme seção 4.3 (sem `password`).

### 400 Bad Request
- Um ou mais campos do corpo da requisição são inválidos ou estão ausentes, ou o corpo contém campos não previstos no DTO.
- Corpo da resposta: estrutura padrão de erro do NestJS, contendo a lista de mensagens de validação (uma por regra violada), identificando os campos problemáticos.
- Nenhum usuário é criado.

### 409 Conflict
- Já existe um usuário cadastrado com o e-mail informado.
- Corpo da resposta: mensagem indicando que o e-mail já está em uso.
- Nenhum dado é alterado no banco.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Existe um `AuthModule`, com `AuthController` e `AuthService`, importado pelo `AppModule`.
- [ ] **CA2** — Uma requisição `POST /auth/register` com corpo válido (email, password, firstName, lastName, role) retorna **201** e o usuário criado, contendo `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`.
- [ ] **CA3** — A resposta de sucesso do CA2 **não** contém, em nenhum nível, o campo `password` ou qualquer variação dele.
- [ ] **CA4** — O usuário criado no CA2 é persistido no banco com `status = active`, mesmo que o campo `status` não tenha sido enviado no corpo da requisição.
- [ ] **CA5** — O valor de `password` armazenado no banco para o usuário do CA2 é um hash bcrypt (não é igual ao texto plano enviado) e é possível validar esse hash contra a senha original usando bcrypt.
- [ ] **CA6** — Repetir o cadastro do CA2 com o mesmo `email` (idêntico ou variando apenas maiúsculas/minúsculas) retorna **409 Conflict** e não cria um segundo registro no banco.
- [ ] **CA7** — Enviar o corpo sem `email`, com `email` em formato inválido, sem `password`, com `password` menor que 6 caracteres, sem `firstName`/`lastName`, com `firstName`/`lastName` maior que 100 caracteres, sem `role`, ou com `role` fora de `seller`/`buyer` — cada um desses casos, isoladamente, retorna **400 Bad Request** com mensagem de validação identificando o campo e a regra violada.
- [ ] **CA8** — Enviar `status` (ou qualquer outro campo fora do DTO) no corpo da requisição retorna **400 Bad Request** (efeito do `forbidNonWhitelisted`), e nenhum usuário é criado com o valor enviado.
- [ ] **CA9** — Nenhuma das respostas de erro (400 ou 409) expõe o campo `password`.
- [ ] **CA10** — O endpoint `POST /auth/register` é a única rota exposta pelo `AuthModule` nesta spec (sem login, refresh, JWT ou qualquer outra rota de autenticação).

---

## 7. Dependências e sequência

Depende da spec [`01 - scaffold`](./01%20-%20scaffold.md) (entidade `User` e `UsersModule` já existentes).

Requer a adição da dependência de runtime `bcryptjs` (e seus tipos, se necessário) ao `package.json` do `users-service`.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. Login (`POST /auth/login`) com verificação de senha via bcrypt.
2. Emissão e validação de JWT.
3. Integração da autenticação com o `api-gateway`.
