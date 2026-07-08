# SPEC: Criação de produto (`POST /products`)

> **Objetivo:** Permitir que usuários com papel `seller` cadastrem produtos no catálogo do
> `products-service`, associando automaticamente o produto ao vendedor autenticado.
>
> **Escopo desta spec:** `ProductsController`, `ProductsService`, DTO de criação e o endpoint
> `POST /products`.
> **Fora de escopo:** endpoints de consulta (listagem/detalhe), atualização ou remoção de produtos,
> upload de imagens, categorias de produto, e validação de que o `sellerId` corresponde a um
> vendedor existente no `users-service`. Tudo isso será tratado em specs futuras.

---

## 1. Contexto

Esta é a terceira spec do `products-service`, na sequência de [`01 - scaffold`](./01%20-%20scaffold.md) e [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md). O que já existe hoje:

- Scaffold NestJS funcional, com `AppModule`, `TypeOrmModule` e a entidade `Product` (`id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`).
- `ProductsModule` registrando a entidade `Product` no TypeORM, sem controller, service ou rota.
- Autenticação JWT ativa globalmente (`JwtAuthGuard` como `APP_GUARD`): toda rota exige token válido, a menos que marcada com `@Public()`.
- A partir de um token válido, `req.user` disponível em qualquer rota protegida, contendo `id`, `email` e `role` (`role` é `"seller"` ou `"buyer"`), conforme [`AuthenticatedUser`](../../src/common/interfaces/authenticated-user.interface.ts).
- `ValidationPipe` global habilitado (`transform`, `whitelist`, `forbidNonWhitelisted`).

Esta spec adiciona a primeira funcionalidade de negócio do serviço: o cadastro de um produto, restrito a usuários vendedores.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos módulos existentes).
- **ORM:** TypeORM, via repositório da entidade `Product` já registrado no `ProductsModule`.
- **Validação:** `class-validator` + `class-transformer` (já configurados globalmente).
- **Autorização:** verificação do papel do usuário autenticado (`req.user.role`), reaproveitando o mecanismo de autenticação já existente — sem introduzir, nesta spec, um `RoleGuard` genérico ou decorator de roles.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário para esta spec.

---

## 3. Requisitos funcionais

### RF1 — `ProductsController` e `ProductsService`
- Deve existir um `ProductsService`, responsável pela regra de negócio de criação do produto (verificação de papel e persistência).
- Deve existir um `ProductsController`, responsável por expor a rota HTTP e delegar a criação ao `ProductsService`.
- Ambos devem ser registrados no `ProductsModule` já existente.

### RF2 — Endpoint `POST /products`
- Deve expor a rota `POST /products`, que recebe os dados do produto no corpo da requisição.
- Por não estar marcada com `@Public()`, a rota exige token JWT válido (comportamento já garantido pelo guard global da spec anterior).

### RF3 — Verificação do papel do usuário (somente `seller`)
- Antes de criar o produto, o sistema deve verificar se o usuário autenticado (`req.user.role`) possui o papel `seller`.
- Se o usuário autenticado não for `seller` (ou seja, for `buyer`), a requisição deve ser rejeitada com **403 Forbidden**, sem persistir nenhum dado.
- Se o usuário for `seller`, o fluxo de criação segue normalmente.

### RF4 — Origem do `sellerId`
- O `sellerId` do produto **nunca** deve ser aceito como campo do corpo da requisição — o DTO de criação não possui esse campo.
- O `sellerId` deve ser extraído automaticamente do usuário autenticado (`req.user.id`), obtido a partir do token JWT validado pelo guard global.
- Qualquer valor de `sellerId` eventualmente enviado no corpo da requisição deve ser ignorado (efeito do `whitelist`/`forbidNonWhitelisted` já configurado globalmente, que rejeita campos fora do DTO).

### RF5 — Status inicial do produto
- Todo produto criado por este endpoint deve receber automaticamente `isActive = true`.
- O valor de `isActive` não deve ser aceito como entrada do cliente neste endpoint (não faz parte do DTO de criação).

### RF6 — Validação dos dados de entrada
- Todos os campos do DTO de criação (seção 4) devem ser validados antes de qualquer verificação de papel ou acesso ao banco.
- Requisições com dados inválidos devem ser rejeitadas com **400 Bad Request**, sem chegar a consultar ou alterar o banco.
- As mensagens de erro de validação devem ser claras e identificar o campo e a regra violada (ex.: "name must be shorter than or equal to 255 characters", "price must not be less than 0.01"), aproveitando as mensagens padrão do `class-validator` ou mensagens customizadas equivalentes.
- Campos não previstos no DTO enviados pelo cliente devem ser descartados/rejeitados (comportamento já garantido pelo `whitelist: true` e `forbidNonWhitelisted: true` do `ValidationPipe` global).

---

## 4. Estrutura de dados

### 4.1 DTO de entrada — `CreateProductDto` (corpo de `POST /products`)

| Campo         | Tipo   | Regras                                                                 |
| ------------- | ------ | ----------------------------------------------------------------------- |
| `name`        | string | Obrigatório. Máximo de **255 caracteres**.                              |
| `description` | string | Obrigatório. Texto livre, sem limite de tamanho definido nesta spec.    |
| `price`       | number | Obrigatório. Número decimal com no máximo **2 casas decimais**. Mínimo **0.01**. |
| `stock`       | number | Obrigatório. Número inteiro. Mínimo **0**.                              |

- Nenhum outro campo é aceito neste DTO (em particular, `sellerId`, `isActive`, `id`, `createdAt` e `updatedAt` não podem ser informados pelo cliente).

### 4.2 Dados persistidos — entidade `Product`

O registro criado no banco usa a entidade `Product` já existente (spec 01), preenchida da seguinte forma a partir do `CreateProductDto`:

| Campo         | Origem                                                              |
| ------------- | ---------------------------------------------------------------------- |
| `id`          | Gerado automaticamente pelo banco.                                     |
| `name`        | Valor informado no DTO.                                                |
| `description` | Valor informado no DTO.                                                |
| `price`       | Valor informado no DTO.                                                |
| `stock`       | Valor informado no DTO.                                                |
| `sellerId`    | `id` do usuário autenticado (`req.user.id`), extraído do token JWT — não vem do DTO. |
| `isActive`    | Sempre `true`, definido pelo sistema (não vem do DTO).                  |
| `createdAt`   | Preenchido automaticamente na criação.                                  |
| `updatedAt`   | Preenchido automaticamente na criação.                                  |

### 4.3 Dados de saída — resposta de sucesso

Representa o produto criado, com todos os campos da entidade:

| Campo         | Tipo                  |
| ------------- | --------------------- |
| `id`          | string (UUID)          |
| `name`        | string                 |
| `description` | string                 |
| `price`       | number                 |
| `stock`       | number                 |
| `sellerId`    | string (UUID)          |
| `isActive`    | boolean                |
| `createdAt`   | timestamp (ISO 8601)   |
| `updatedAt`   | timestamp (ISO 8601)   |

---

## 5. Respostas esperadas

### 201 Created
- Produto criado com sucesso.
- Corpo da resposta: objeto do produto conforme seção 4.3, com `sellerId` igual ao `id` do usuário autenticado e `isActive = true`.

### 400 Bad Request
- Um ou mais campos do corpo da requisição são inválidos ou estão ausentes, ou o corpo contém campos não previstos no DTO.
- Corpo da resposta: estrutura padrão de erro do NestJS, contendo a lista de mensagens de validação (uma por regra violada), identificando os campos problemáticos.
- Nenhum produto é criado.

### 401 Unauthorized
- O header `Authorization` está ausente, malformado, ou o token é inválido/expirado (comportamento já garantido pelo `JwtAuthGuard` global, spec 02).
- Nenhum produto é criado; o `ProductsController` não é executado.

### 403 Forbidden
- O usuário autenticado possui token válido, mas seu papel (`req.user.role`) é `buyer` (ou qualquer valor diferente de `seller`).
- Corpo da resposta: mensagem indicando que o usuário não tem permissão para cadastrar produtos.
- Nenhum produto é criado.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Existem `ProductsController` e `ProductsService`, registrados no `ProductsModule` já existente.
- [ ] **CA2** — Uma requisição `POST /products` com token JWT válido de um usuário `seller` e corpo válido (`name`, `description`, `price`, `stock`) retorna **201** e o produto criado, contendo `id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`.
- [ ] **CA3** — No cenário do CA2, o `sellerId` do produto retornado e persistido no banco é igual ao `id` do usuário autenticado (`sub` do token), mesmo que a requisição não envie nenhum `sellerId` no corpo.
- [ ] **CA4** — No cenário do CA2, o produto é persistido no banco com `isActive = true`, mesmo que o campo `isActive` não tenha sido enviado no corpo da requisição.
- [ ] **CA5** — Enviar `sellerId` ou `isActive` no corpo da requisição do CA2 não altera o resultado: o `sellerId` persistido continua sendo o `id` do usuário autenticado e `isActive` continua `true` — e a requisição retorna **400 Bad Request** (efeito do `forbidNonWhitelisted`, já que esses campos não fazem parte do DTO).
- [ ] **CA6** — Uma requisição `POST /products` sem header `Authorization`, ou com token malformado/expirado/com assinatura inválida, retorna **401 Unauthorized** e nenhum produto é criado.
- [ ] **CA7** — Uma requisição `POST /products` com token JWT válido de um usuário com `role = "buyer"` retorna **403 Forbidden** e nenhum produto é criado.
- [ ] **CA8** — Enviar o corpo sem `name`, com `name` maior que 255 caracteres, sem `description`, sem `price`, com `price` menor que 0.01, com `price` com mais de 2 casas decimais, sem `stock`, com `stock` negativo, ou com `stock` não inteiro — cada um desses casos, isoladamente (com um usuário `seller` autenticado), retorna **400 Bad Request** com mensagem de validação identificando o campo e a regra violada.
- [ ] **CA9** — Nos cenários de erro (400, 401 e 403), nenhum registro é inserido na tabela de produtos.
- [ ] **CA10** — O endpoint `POST /products` é a única rota exposta pelo `ProductsModule` nesta spec (sem listagem, detalhe, atualização, remoção, upload de imagens ou categorias).
- [ ] **CA11** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Depende das specs [`01 - scaffold`](./01%20-%20scaffold.md) (entidade `Product` e `ProductsModule`) e [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md) (guard global e `req.user` com `id`/`email`/`role`) deste serviço.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. Endpoints de consulta de produtos (listagem e detalhe).
2. Atualização e remoção de produtos (restritas ao vendedor dono do produto).
3. Validação de que o `sellerId` corresponde a um vendedor existente no `users-service`.
4. Upload de imagens e categorias de produto.
