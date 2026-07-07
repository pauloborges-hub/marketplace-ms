# SPEC: Endpoints de consulta de usuários (`GET /users/profile`, `GET /users/sellers`, `GET /users/:id`)

> **Objetivo:** Expor os endpoints essenciais de consulta de usuários necessários para o
> funcionamento do marketplace: o usuário autenticado consultar seus próprios dados, o
> frontend/`products-service` listarem vendedores ativos, e a consulta de um usuário específico
> por ID.
>
> **Escopo desta spec:** criação do `UsersService` e do `UsersController`, com os três endpoints
> de leitura descritos acima, registrados no `UsersModule`.
> **Fora de escopo:** criação, atualização, remoção ou paginação de usuários, troca de senha,
> listagem geral de usuários (sem filtro), e controle de acesso por papel (`RoleGuard`) — todos
> os endpoints ficam protegidos apenas pelo `JwtAuthGuard` global já existente. Tudo isso será
> tratado em specs futuras, se necessário.

---

## 1. Contexto

Esta é a quinta spec do `users-service`, na sequência de
[`04 - route-protection-jwt-guard`](./04%20-%20route-protection-jwt-guard.md). O que já existe hoje:

- Entidade `User` (`id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`,
  `createdAt`, `updatedAt`), com `role` (`seller`/`buyer`) e `status` (`active`/`inactive`) como
  enums.
- `UsersModule`, importando `TypeOrmModule.forFeature([User])` e exportando `TypeOrmModule` — ainda
  sem `UsersController` nem `UsersService`.
- `JwtAuthGuard` aplicado globalmente (via `APP_GUARD`), exigindo token JWT válido em toda rota que
  não esteja marcada com `@Public()`.
- Com um token válido, `req.user` contém `id`, `email` e `role` do usuário autenticado (o `status`
  **não** está disponível em `req.user` — apenas no banco).
- Nenhum endpoint de consulta de usuários existe até o momento.

Esta spec adiciona a primeira funcionalidade real do `UsersModule`: os três endpoints de leitura
necessários para o marketplace operar.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos módulos existentes).
- **ORM:** TypeORM, via repositório da entidade `User` já registrado no `UsersModule`.
- **Autenticação:** todos os endpoints desta spec são protegidos automaticamente pelo
  `JwtAuthGuard` global — nenhum deles deve ser marcado com `@Public()`.
- **Responsabilidade:** toda lógica de consulta (acesso ao repositório, filtros, omissão do campo
  `password`) pertence ao `UsersService`; o `UsersController` apenas recebe a requisição, extrai os
  parâmetros necessários (incluindo `req.user` quando aplicável) e delega ao service.
- O projeto deve continuar **enxuto** — sem dependências ou abstrações além do necessário para
  esta spec (sem paginação, sem filtros adicionais, sem DTOs de saída além da omissão de
  `password`).

---

## 3. Requisitos funcionais

### RF1 — Endpoint `GET /users/profile`
- Deve expor a rota `GET /users/profile`, protegida pelo `JwtAuthGuard` (nenhuma marcação
  `@Public()`).
- O usuário a ser consultado é sempre o usuário autenticado da requisição — o `id` usado na busca
  deve vir de `req.user.id` (nunca de um parâmetro de URL, query string ou corpo da requisição).
- A busca deve ser feita diretamente no banco pelo `id`, e não a partir dos dados já presentes no
  token — isso garante que a resposta reflita o estado mais atual do usuário (ex.: caso o `status`
  ou qualquer outro campo tenha mudado desde a emissão do token).
- Se o usuário referenciado pelo token não existir mais no banco (ex.: removido após a emissão do
  token), a requisição deve ser rejeitada com **404 Not Found**.

### RF2 — Endpoint `GET /users/sellers`
- Deve expor a rota `GET /users/sellers`, protegida pelo `JwtAuthGuard`.
- Deve retornar uma lista contendo **todos** os usuários cujo `role` seja `seller` **e** cujo
  `status` seja `active` — ambos os filtros são obrigatórios e combinados com E lógico.
- Usuários com `role = seller` mas `status = inactive` não devem aparecer na lista.
- Usuários com `role = buyer`, independentemente do `status`, não devem aparecer na lista.
- Se não houver nenhum vendedor ativo, a resposta deve ser **200 OK** com uma lista vazia (não é
  um cenário de erro).
- Esta rota é consumida tanto pelo frontend quanto por outros serviços (ex.: `products-service`),
  portanto a resposta não deve depender de nenhum dado específico do usuário autenticado que fez a
  requisição — qualquer usuário autenticado, de qualquer papel, deve receber a mesma lista.

### RF3 — Endpoint `GET /users/:id`
- Deve expor a rota `GET /users/:id`, protegida pelo `JwtAuthGuard`, onde `:id` é o identificador
  (UUID) do usuário a ser consultado.
- Deve retornar os dados do usuário cujo `id` corresponda exatamente ao parâmetro informado.
- Se nenhum usuário existir com o `id` informado, a requisição deve ser rejeitada com
  **404 Not Found**.
- Se o `id` informado não for um UUID em formato válido, a requisição deve ser rejeitada antes de
  qualquer consulta ao banco (ver RF6).
- Esta rota permite consultar os dados de **qualquer** usuário (seller ou buyer, ativo ou
  inativo) pelo ID — não há restrição de papel do usuário autenticado que faz a requisição nesta
  spec.

### RF4 — Omissão do campo `password`
- Em nenhuma das três respostas (RF1, RF2, RF3) o campo `password` (hash ou texto plano) deve
  estar presente, em nenhum nível do corpo da resposta — nem no objeto único, nem em nenhum item
  da lista de sellers.
- A responsabilidade de omitir o campo `password` pertence ao `UsersService`, de forma consistente
  entre os três endpoints (mesma regra de omissão já aplicada em `register` e `login`).

### RF5 — Ordem de declaração das rotas
- As rotas estáticas `GET /users/profile` e `GET /users/sellers` devem ser declaradas, no
  `UsersController`, **antes** da rota dinâmica `GET /users/:id`.
- Essa ordem é obrigatória para que requisições a `/users/profile` e `/users/sellers` não sejam
  incorretamente interceptadas pela rota dinâmica (que, caso viesse primeiro, trataria `profile` e
  `sellers` como valores de `:id`).

### RF6 — Validação do parâmetro `:id`
- O parâmetro `:id` da rota `GET /users/:id` deve ser validado como um UUID antes de qualquer
  acesso ao banco.
- Se o valor informado não for um UUID válido, a requisição deve ser rejeitada com
  **400 Bad Request**, sem chegar a consultar o banco.

### RF7 — Estrutura do módulo
- O `UsersService` deve ser criado dentro do `UsersModule`, contendo os métodos de consulta
  necessários para os três endpoints (busca por ID e busca de sellers ativos).
- O `UsersController` deve ser criado dentro do `UsersModule`, contendo os três endpoints desta
  spec e delegando toda a lógica de consulta ao `UsersService`.
- O `UsersService` deve ser registrado nos `providers` e o `UsersController` nos `controllers` do
  `UsersModule`.
- Nenhum outro módulo (`AuthModule`, `AppModule`) deve conter lógica de consulta de usuários —
  toda ela pertence ao `UsersModule`.

---

## 4. Estrutura de dados

### 4.1 Corpo da resposta — usuário único (`GET /users/profile`, `GET /users/:id`)

| Campo       | Tipo   | Descrição                                                    |
| ----------- | ------ | -------------------------------------------------------------- |
| `id`        | string (UUID) | Identificador do usuário.                              |
| `email`     | string | E-mail do usuário.                                             |
| `firstName` | string | Primeiro nome do usuário.                                      |
| `lastName`  | string | Sobrenome do usuário.                                          |
| `role`      | enum (`seller`/`buyer`) | Papel do usuário.                             |
| `status`    | enum (`active`/`inactive`) | Status da conta.                          |
| `createdAt` | date   | Data de criação do registro.                                   |
| `updatedAt` | date   | Data da última atualização do registro.                        |

- O campo `password` nunca está presente.

### 4.2 Corpo da resposta — lista de sellers (`GET /users/sellers`)

- Um array, onde cada item segue exatamente a estrutura da seção 4.1.
- Todos os itens têm `role = seller` e `status = active`.

---

## 5. Respostas esperadas

### `GET /users/profile`
- **200 OK** — usuário autenticado encontrado no banco; corpo conforme seção 4.1.
- **401 Unauthorized** — token ausente ou inválido (tratado automaticamente pelo `JwtAuthGuard`,
  antes de o controller ser executado).
- **404 Not Found** — o token é válido, mas o usuário referenciado por ele não existe mais no
  banco.

### `GET /users/sellers`
- **200 OK** — lista de usuários com `role = seller` e `status = active` (pode ser uma lista
  vazia); corpo conforme seção 4.2.
- **401 Unauthorized** — token ausente ou inválido.

### `GET /users/:id`
- **200 OK** — usuário com o `id` informado encontrado; corpo conforme seção 4.1.
- **401 Unauthorized** — token ausente ou inválido.
- **400 Bad Request** — o valor informado em `:id` não é um UUID válido.
- **404 Not Found** — o `id` informado é um UUID válido, mas nenhum usuário existe com esse `id`.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Uma requisição `GET /users/profile` com token válido retorna **200** com os dados
      do usuário correspondente ao `id` do token, buscados no banco (não apenas os dados
      embutidos no próprio token).
- [ ] **CA2** — Uma requisição `GET /users/profile` sem token, ou com token inválido/expirado,
      retorna **401 Unauthorized**.
- [ ] **CA3** — Uma requisição `GET /users/profile` com um token válido cujo `id` não corresponde
      a nenhum usuário existente no banco retorna **404 Not Found**.
- [ ] **CA4** — O corpo da resposta do CA1 não contém o campo `password` em nenhum nível.
- [ ] **CA5** — Uma requisição `GET /users/sellers` com token válido retorna **200** com uma lista
      contendo apenas usuários com `role = seller` e `status = active`.
- [ ] **CA6** — Um usuário com `role = seller` e `status = inactive` **não** aparece na lista do
      CA5.
- [ ] **CA7** — Um usuário com `role = buyer` (independentemente do `status`) **não** aparece na
      lista do CA5.
- [ ] **CA8** — Se não houver nenhum vendedor ativo cadastrado, `GET /users/sellers` retorna
      **200** com uma lista vazia.
- [ ] **CA9** — Nenhum item da lista retornada por `GET /users/sellers` contém o campo `password`.
- [ ] **CA10** — Uma requisição `GET /users/sellers` sem token, ou com token inválido/expirado,
      retorna **401 Unauthorized**.
- [ ] **CA11** — Uma requisição `GET /users/:id` com um UUID válido de um usuário existente
      retorna **200** com os dados desse usuário, conforme seção 4.1.
- [ ] **CA12** — Uma requisição `GET /users/:id` com um UUID válido que não corresponde a nenhum
      usuário existente retorna **404 Not Found**.
- [ ] **CA13** — Uma requisição `GET /users/:id` com um valor que não é um UUID válido (ex.:
      `abc123`) retorna **400 Bad Request**, sem consultar o banco.
- [ ] **CA14** — Uma requisição `GET /users/:id` sem token, ou com token inválido/expirado, retorna
      **401 Unauthorized**.
- [ ] **CA15** — O corpo da resposta do CA11 não contém o campo `password`.
- [ ] **CA16** — Uma requisição `GET /users/profile` funciona corretamente mesmo quando existe um
      usuário cujo `id` (UUID) começaria a corresponder à rota dinâmica `:id` — ou seja, a rota
      `/users/profile` nunca é interpretada como `/users/:id` com `id = "profile"` (validado pela
      ordem de declaração das rotas, RF5).
- [ ] **CA17** — O mesmo do CA16 se aplica a `/users/sellers`: a rota nunca é interpretada como
      `/users/:id` com `id = "sellers"`.
- [ ] **CA18** — Toda a lógica de consulta (acesso ao repositório e omissão de `password`) está
      implementada no `UsersService`, e o `UsersController` apenas delega a ele.

---

## 7. Dependências e sequência

Depende das specs [`02 - user-registration`](./02%20-%20user-registration.md) (entidade `User`) e
[`04 - route-protection-jwt-guard`](./04%20-%20route-protection-jwt-guard.md) (`JwtAuthGuard`
global e `req.user`).

Não requer novas dependências de runtime nem novas variáveis de ambiente — apenas a criação do
`UsersService` e do `UsersController` dentro do `UsersModule` já existente.

Specs futuras (fora do escopo aqui) poderão cobrir, se necessário:
1. Atualização de dados do próprio usuário (`PATCH /users/profile`) e troca de senha.
2. Controle de acesso por papel (`RoleGuard`) em endpoints administrativos.
3. Paginação e filtros adicionais em listagens de usuários.
4. Integração destes endpoints com o `api-gateway` e com o `products-service`.
