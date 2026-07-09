# SPEC: Consulta de produtos (`GET /products`, `GET /products/seller/:sellerId`, `GET /products/:id`)

> **Objetivo:** Permitir que qualquer visitante (autenticado ou não) navegue pelo catálogo de
> produtos ativos do `products-service`, liste os produtos de um vendedor específico e consulte
> o detalhe de um produto pelo seu identificador.
>
> **Escopo desta spec:** `ProductsController`, `ProductsService` e os três endpoints públicos de
> consulta: `GET /products`, `GET /products/seller/:sellerId` e `GET /products/:id`.
> **Fora de escopo:** atualização ou remoção de produtos, paginação, filtros (por preço, nome,
> categoria etc.), busca textual, ordenação customizável, e validação de que o `sellerId` da rota
> corresponde a um vendedor existente no `users-service`. Tudo isso será tratado em specs futuras.

---

## 1. Contexto

Esta é a quarta spec do `products-service`, na sequência de [`01 - scaffold`](./01%20-%20scaffold.md), [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md) e [`03 - product-creation`](./03%20-%20product-creation.md). O que já existe hoje:

- Scaffold NestJS funcional, com `AppModule`, `TypeOrmModule` e a entidade `Product` (`id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`).
- Autenticação JWT ativa globalmente (`JwtAuthGuard` como `APP_GUARD`): toda rota exige token válido, a menos que marcada com `@Public()` (decorator [`Public`](../../src/auth/decorators/public.decorator.ts)).
- `ProductsModule` com `ProductsController` e `ProductsService`, expondo `POST /products` (restrito a usuários `seller`, spec 03).

Esta spec adiciona as funcionalidades de consulta necessárias para o funcionamento básico do marketplace: navegar o catálogo, ver a vitrine de um vendedor e visualizar o detalhe de um produto. Diferente da criação, essas consultas não exigem autenticação — o catálogo é aberto ao público.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos módulos existentes).
- **ORM:** TypeORM, via repositório da entidade `Product` já registrado no `ProductsModule`.
- **Acesso público:** rotas marcadas com `@Public()`, reaproveitando o mecanismo já existente do `JwtAuthGuard` global — sem introduzir, nesta spec, um novo guard ou estratégia de autenticação.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário para esta spec (em particular, sem paginação, filtros ou busca textual).

---

## 3. Requisitos funcionais

### RF1 — `ProductsController` e `ProductsService`
- Os três novos endpoints de consulta devem ser expostos pelo `ProductsController` já existente, delegando a busca dos dados ao `ProductsService` já existente.
- Nenhum novo módulo, controller ou service deve ser criado para esta funcionalidade.

### RF2 — Endpoint `GET /products` (listagem do catálogo)
- Deve expor a rota pública `GET /products`, marcada com `@Public()`.
- Deve retornar todos os produtos cujo campo `isActive` seja `true`. Produtos inativos (`isActive = false`) nunca devem aparecer nesta listagem.
- Os produtos retornados devem estar ordenados por `createdAt` de forma decrescente (mais recentes primeiro).
- Se não houver nenhum produto ativo cadastrado, deve retornar uma lista vazia.

### RF3 — Endpoint `GET /products/seller/:sellerId` (vitrine do vendedor)
- Deve expor a rota pública `GET /products/seller/:sellerId`, marcada com `@Public()`, onde `:sellerId` é o identificador do vendedor.
- Deve retornar todos os produtos do vendedor informado cujo campo `isActive` seja `true`. Produtos inativos desse vendedor nunca devem aparecer neste resultado.
- Se o vendedor informado não possuir nenhum produto ativo (ou não existir), deve retornar uma lista vazia — nunca um erro.

### RF4 — Endpoint `GET /products/:id` (detalhe do produto)
- Deve expor a rota pública `GET /products/:id`, marcada com `@Public()`, onde `:id` é o identificador (UUID) do produto.
- Deve retornar os dados completos do produto correspondente ao `id` informado, independentemente do valor de `isActive` (o detalhe de um produto inativo ainda pode ser consultado diretamente pelo `id`).
- Se não existir nenhum produto com o `id` informado, deve retornar **404 Not Found**.

### RF5 — Ordem de declaração das rotas
- No `ProductsController`, a rota `GET /products/seller/:sellerId` deve ser declarada **antes** da rota `GET /products/:id`, para que o segmento fixo `seller` não seja interpretado como valor do parâmetro dinâmico `:id`.
- A rota `GET /products` (sem parâmetros) pode ser declarada em qualquer posição relativa às duas rotas acima, desde que não conflite com elas.

### RF6 — Acesso público, sem exigência de papel
- Nenhum dos três endpoints desta spec deve exigir token JWT nem verificar o papel (`role`) do usuário: são acessíveis tanto por visitantes não autenticados quanto por usuários autenticados (`seller` ou `buyer`).
- Isso contrasta com `POST /products` (spec 03), que continua exigindo autenticação e papel `seller` — esta spec não altera esse comportamento.

---

## 4. Estrutura de dados

### 4.1 Parâmetros de entrada

| Endpoint                          | Parâmetro   | Origem            | Tipo          | Regras                                   |
| ---------------------------------- | ----------- | ------------------ | ------------- | ----------------------------------------- |
| `GET /products`                    | —           | —                   | —              | Nenhum parâmetro.                         |
| `GET /products/seller/:sellerId`   | `sellerId`  | Parâmetro de rota  | string (UUID) | Obrigatório (parte da URL).               |
| `GET /products/:id`                | `id`        | Parâmetro de rota  | string (UUID) | Obrigatório (parte da URL).               |

### 4.2 Dados de saída

Cada produto retornado (seja em lista ou individualmente) usa a entidade `Product` já existente, com todos os seus campos:

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

- `GET /products` e `GET /products/seller/:sellerId` retornam um **array** de produtos (possivelmente vazio).
- `GET /products/:id` retorna um **único objeto** de produto (ou 404, se não existir).

---

## 5. Respostas esperadas

### 200 OK
- **`GET /products`**: retorna um array com todos os produtos ativos (`isActive = true`), ordenados por `createdAt` decrescente. Array vazio se não houver produtos ativos.
- **`GET /products/seller/:sellerId`**: retorna um array com os produtos ativos do vendedor informado. Array vazio se o vendedor não tiver produtos ativos (ou não existir).
- **`GET /products/:id`**: retorna o objeto do produto correspondente ao `id`, ativo ou não.

### 404 Not Found
- Aplica-se apenas a **`GET /products/:id`**, quando não existe produto com o `id` informado.
- Corpo da resposta: estrutura padrão de erro do NestJS, indicando que o produto não foi encontrado.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Os três endpoints (`GET /products`, `GET /products/seller/:sellerId`, `GET /products/:id`) são expostos pelo `ProductsController` já existente, sem exigir header `Authorization`.
- [ ] **CA2** — Uma requisição `GET /products`, sem token, retorna **200** com um array contendo apenas produtos com `isActive = true`, ordenados do mais recente para o mais antigo (`createdAt` decrescente).
- [ ] **CA3** — Se não houver nenhum produto ativo cadastrado, `GET /products` retorna **200** com um array vazio.
- [ ] **CA4** — Uma requisição `GET /products/seller/:sellerId`, sem token, com um `sellerId` que possui produtos ativos, retorna **200** com um array contendo apenas os produtos ativos daquele vendedor (nenhum produto de outro vendedor, nenhum produto inativo).
- [ ] **CA5** — Uma requisição `GET /products/seller/:sellerId` com um `sellerId` sem produtos ativos (ou inexistente) retorna **200** com um array vazio — nunca 404.
- [ ] **CA6** — Uma requisição `GET /products/:id`, sem token, com o `id` de um produto existente (ativo ou inativo), retorna **200** com o objeto completo do produto, contendo `id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`.
- [ ] **CA7** — Uma requisição `GET /products/:id` com um `id` que não corresponde a nenhum produto retorna **404 Not Found**.
- [ ] **CA8** — Uma requisição `GET /products/seller/:sellerId` não é interceptada pela rota `GET /products/:id` (ou seja, `seller` nunca é tratado como valor de `id`), independentemente da ordem em que as requisições de teste sejam feitas.
- [ ] **CA9** — Os três endpoints funcionam tanto sem header `Authorization` quanto com um token JWT válido (de usuário `seller` ou `buyer`) — o resultado é o mesmo em ambos os casos.
- [ ] **CA10** — O endpoint `POST /products` (spec 03) continua exigindo autenticação e papel `seller`, sem alterações de comportamento causadas por esta spec.
- [ ] **CA11** — Nenhum dado é alterado ou removido do banco em decorrência dos endpoints desta spec (são operações somente leitura).
- [ ] **CA12** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Depende das specs [`01 - scaffold`](./01%20-%20scaffold.md) (entidade `Product` e `ProductsModule`), [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md) (guard global e decorator `@Public()`) e [`03 - product-creation`](./03%20-%20product-creation.md) (`ProductsController` e `ProductsService` já existentes) deste serviço.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. Atualização e remoção de produtos (restritas ao vendedor dono do produto).
2. Paginação, filtros e busca textual na listagem do catálogo.
3. Validação de que o `sellerId` corresponde a um vendedor existente no `users-service`.
4. Upload de imagens e categorias de produto.
