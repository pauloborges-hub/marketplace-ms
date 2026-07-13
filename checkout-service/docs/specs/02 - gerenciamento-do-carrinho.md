# SPEC: Gerenciamento do carrinho (`Cart`/`CartItem`) no `checkout-service`

> **Objetivo:** Permitir que um usuário autenticado (seller ou buyer) monte seu carrinho de compras
> consultando dados reais de produto no `products-service`, adicionando e removendo itens, com o
> total do carrinho sempre consistente com os itens presentes.
>
> **Escopo desta spec:** `ProductsClientService` (comunicação HTTP com o `products-service`);
> endpoints `POST /cart/items`, `GET /cart` e `DELETE /cart/items/:itemId`; `CartService` com a
> lógica de negócio de adicionar/consultar/remover itens e recalcular o total; DTOs de
> request/response desses três endpoints.
> **Fora de escopo:** checkout/finalização do carrinho (criação de `Order` a partir do carrinho) —
> tratado em spec futura. Alteração de quantidade de um item já existente — a forma suportada de
> mudar a quantidade é remover o item (`DELETE /cart/items/:itemId`) e adicioná-lo novamente
> (`POST /cart/items`) com a nova quantidade. Qualquer endpoint de listagem/gestão de carrinho por
> terceiros (ex.: admin ver carrinho de outro usuário). Cache, retry, circuit breaker ou qualquer
> resiliência adicional na chamada ao `products-service` além do tratamento de erro descrito aqui.
> Reserva de estoque no `products-service` a partir do carrinho.

---

## 1. Contexto

O `checkout-service` (porta 3003) já possui, graças à spec anterior
(`01 - domain-entities-and-jwt-authentication.md`):

- Entidades TypeORM `Cart` (com `items` eager e `total` decimal) e `CartItem` (com `productId`,
  `productName`, `price`, `quantity`, `subtotal` — todos já modelados como snapshot do produto no
  momento da adição), registradas em `CartModule` (`TypeOrmModule.forFeature`), mas sem controller,
  service ou DTO algum.
- `AuthModule` com `JwtStrategy`, `JwtAuthGuard` global (via `APP_GUARD`) e decorator `@Public()` —
  toda rota nova criada nesta spec é protegida por padrão, sem necessidade de configuração adicional.
- `req.user` disponível em qualquer rota protegida, tipado por `AuthenticatedUser`
  (`id`, `email`, `role`), preenchido a partir do payload do JWT.
- `@nestjs/axios` e `axios` já constam como dependências no `package.json` (não é necessário
  adicionar nenhuma dependência nova para consumir HTTP).
- `PRODUCTS_SERVICE_URL` já configurado no `.env` (`http://localhost:3001` em desenvolvimento).

O `products-service` (porta 3001) já expõe publicamente `GET /products/:id` (sem autenticação),
retornando o produto (`id`, `name`, `price`, `stock`, `isActive`, `sellerId`, entre outros campos) ou
**404** quando o `id` não corresponde a nenhum produto. Esse endpoint **não** filtra por
`isActive` — um produto inativo também é retornado normalmente, com `isActive: false`; cabe a quem
consome o endpoint decidir se aceita ou rejeita o produto com base nesse campo.

Esta spec cobre a primeira fatia de negócio do `checkout-service`: montar e manter o carrinho de
compras de um usuário autenticado, com validação de produto feita em tempo real contra o
`products-service`.

---

## 2. Stack e padrões

- **Framework:** NestJS 11, seguindo os mesmos padrões já estabelecidos no serviço (módulos por
  domínio, DTOs com `class-validator`, guard global de autenticação).
- **Comunicação HTTP entre serviços:** `HttpModule` do `@nestjs/axios`, encapsulado em um service
  dedicado (`ProductsClientService`) — nenhum outro ponto do código deve montar URLs ou chamar o
  `products-service` diretamente.
- **Configuração:** a URL base do `products-service` deve ser lida do `.env`
  (`PRODUCTS_SERVICE_URL`) através do `ConfigService`, nunca hardcoded.
- **Validação de entrada:** DTOs com `class-validator`, seguindo o padrão já usado no
  `products-service` (`CreateProductDto`) — validação de tipo, formato (UUID) e valor mínimo.
- **Autorização:** os três endpoints desta spec são protegidos pelo guard global já existente —
  nenhum deles deve ser marcado como `@Public()`.
- **Escopo por usuário:** toda operação de carrinho usa exclusivamente o `id` do usuário autenticado
  (`req.user.id`) para localizar o carrinho — nenhum endpoint recebe `userId` como parâmetro de
  entrada.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário
  para esta spec.

---

## 3. Requisitos funcionais

### RF1 — `ProductsClientService`
- Deve existir um service dedicado, responsável exclusivamente por comunicação HTTP com o
  `products-service`.
- Deve expor um método que, dado um `productId`, busque o produto correspondente via
  `GET /products/:id` no `products-service` e retorne os dados do produto.
- A URL base do `products-service` usada nessa chamada deve vir da variável de ambiente
  `PRODUCTS_SERVICE_URL`, lida via `ConfigService` — nenhuma URL deve ser montada fora deste service.
- Quando o `products-service` responder com **404** (produto inexistente), este service deve
  sinalizar essa condição de forma que o chamador consiga tratá-la como "produto não encontrado".
- Quando o `products-service` estiver indisponível (erro de rede, timeout ou qualquer erro que não
  seja um 404 vindo da API) essa condição também deve ser sinalizada de forma distinguível de um
  produto simplesmente não encontrado, permitindo ao chamador reportar um erro apropriado (ver RF3).
- Este service não deve conter nenhuma lógica de negócio de carrinho — sua única responsabilidade é
  buscar dados de produto.

### RF2 — Módulo do `ProductsClientService`
- O `ProductsClientService` deve ser registrado em um módulo que importe `HttpModule` configurado
  (ao menos com a URL base do `products-service`), tornando o service disponível para injeção onde
  for necessário (`CartModule`).

### RF3 — `POST /cart/items` (adicionar item ao carrinho)
- Endpoint protegido; requer usuário autenticado.
- Recebe no corpo da requisição:
  - `productId`: UUID do produto, obrigatório.
  - `quantity`: número inteiro, obrigatório, valor mínimo 1.
- Fluxo esperado:
  1. Valida o formato do corpo da requisição (`productId` é um UUID válido; `quantity` é um inteiro
     ≥ 1). Corpo inválido é rejeitado antes de qualquer chamada ao `products-service` ou ao banco.
  2. Busca o produto no `products-service` através do `ProductsClientService`.
  3. Se o produto não existir (404 do `products-service`), a requisição é rejeitada.
  4. Se o produto existir mas `isActive` for `false`, a requisição é rejeitada — produtos inativos
     não podem ser adicionados ao carrinho.
  5. Se o `products-service` estiver indisponível, a requisição é rejeitada com um erro que deixe
     claro que a falha foi de comunicação com um serviço externo, não do próprio `checkout-service`.
  6. Localiza (ou cria, caso não exista) o carrinho ativo (`status: active`) do usuário autenticado
     (`req.user.id`) — ver RF6.
  7. Verifica se já existe, no carrinho, um item para o mesmo `productId`.
     - Se **existir**: soma a `quantity` recebida à quantidade já presente nesse item, e recalcula o
       `subtotal` desse item (`price` já salvo no item × nova quantidade) — o `price` gravado
       originalmente no item **não** é atualizado com um preço mais recente do produto.
     - Se **não existir**: cria um novo `CartItem`, gravando como snapshot o `productId`, o nome
       (`productName`) e o preço (`price`) do produto **no momento desta requisição**, junto com a
       `quantity` recebida e o `subtotal` calculado (`price × quantity`).
  8. Recalcula o `total` do carrinho como a soma dos `subtotal` de todos os seus itens.
  9. Persiste as alterações.
  10. Retorna o carrinho completo (itens e total) refletindo o estado após a operação.
- Este endpoint não consulta nem reserva o `stock` do produto — a validação de estoque disponível
  fica fora do escopo desta spec.

### RF4 — `GET /cart` (consultar carrinho)
- Endpoint protegido; requer usuário autenticado.
- Retorna o carrinho ativo (`status: active`) do usuário autenticado (`req.user.id`), com todos os
  seus itens e o `total` atual.
- Se o usuário autenticado não possuir nenhum carrinho ativo, o endpoint retorna, ainda assim, uma
  resposta bem-sucedida representando um carrinho vazio (sem itens, `total` igual a zero) — sem criar
  nenhum registro no banco nesse caso.
- Este endpoint nunca cria, nem tem efeito colateral algum sobre, o carrinho do usuário — é somente
  leitura.

### RF5 — `DELETE /cart/items/:itemId` (remover item do carrinho)
- Endpoint protegido; requer usuário autenticado.
- Recebe `itemId` (UUID) como parâmetro de rota, identificando o `CartItem` a ser removido.
- Fluxo esperado:
  1. Valida o formato de `itemId` (UUID válido).
  2. Localiza o item pelo `itemId`. Se não existir nenhum item com esse `id`, a requisição é
     rejeitada.
  3. Verifica se o item pertence a um carrinho do usuário autenticado (`req.user.id`). Se o item
     existir mas pertencer ao carrinho de outro usuário, a requisição é rejeitada da mesma forma que
     um item inexistente (sem revelar a um usuário que o `itemId` pertence a outra pessoa).
  4. Remove o item do carrinho.
  5. Recalcula o `total` do carrinho como a soma dos `subtotal` dos itens restantes (zero, se o item
     removido era o único).
  6. Persiste as alterações.
  7. Retorna o carrinho atualizado (itens restantes e novo total).
- Este endpoint não altera a `quantity` de um item existente — remove o item por completo. Reduzir a
  quantidade de um item é feito removendo-o e adicionando-o novamente (`POST /cart/items`) com a nova
  quantidade.

### RF6 — Obtenção do carrinho ativo do usuário
- Deve existir uma forma centralizada (usada tanto por RF3 quanto por RF4 e RF5) de obter o carrinho
  ativo do usuário autenticado.
- Se o usuário não possuir nenhum carrinho com `status: active`, um novo carrinho deve ser criado
  para ele (com `total` zero e sem itens) **apenas quando a operação exigir persistência** (isto é,
  ao adicionar um item — RF3). A leitura pura (RF4) não deve criar um carrinho novo.
- Um usuário nunca deve terminar, como resultado de qualquer operação desta spec, com mais de um
  carrinho em `status: active` simultaneamente.

### RF7 — DTOs de request
- Deve existir um DTO para o corpo de `POST /cart/items`, validando `productId` (UUID, obrigatório) e
  `quantity` (inteiro, obrigatório, mínimo 1), rejeitando a requisição antes de qualquer chamada a
  serviço externo ou ao banco quando os dados forem inválidos.
- O `itemId` de `DELETE /cart/items/:itemId` deve ser validado como UUID diretamente no parâmetro de
  rota.

### RF8 — Formato de resposta do carrinho
- Os três endpoints desta spec (`POST /cart/items`, `GET /cart`, `DELETE /cart/items/:itemId`) devem
  retornar o carrinho no mesmo formato: identificação do carrinho, `status`, lista de itens (cada um
  com, no mínimo, `id`, `productId`, `productName`, `price`, `quantity` e `subtotal`) e o `total`
  atual do carrinho.

---

## 4. Regras de negócio

- **RN1** — Cada usuário possui, no máximo, um carrinho com `status: active` por vez.
- **RN2** — `productName` e `price` são gravados no `CartItem` como uma cópia (snapshot) dos dados do
  produto no momento em que o item é adicionado ao carrinho; alterações posteriores de preço ou nome
  no `products-service` não afetam itens já adicionados ao carrinho.
- **RN3** — `subtotal` de um item é sempre `price × quantity`, usando o `price` gravado nesse item
  (nunca um preço buscado novamente no `products-service`).
- **RN4** — `total` do carrinho é sempre a soma dos `subtotal` de todos os seus itens — nunca um
  valor mantido independentemente dos itens.
- **RN5** — Somente produtos com `isActive: true` no momento da adição podem ser incluídos no
  carrinho.
- **RN6** — Um usuário só pode ler, adicionar itens a, ou remover itens de, o próprio carrinho —
  jamais o carrinho de outro usuário, identificado pelo `id` extraído do token JWT (`req.user.id`),
  nunca por um parâmetro de entrada.
- **RN7** — Tanto usuários com `role: seller` quanto `role: buyer` podem ter e manipular um carrinho
  — nenhum dos três endpoints desta spec restringe acesso por `role`.

---

## 5. Respostas esperadas

### `POST /cart/items`
- **201/200** — corpo válido, produto existente e ativo: retorna o carrinho atualizado com o item
  adicionado (ou sua quantidade somada) e o `total` recalculado.
- **400 Bad Request** — `productId` ausente ou não é um UUID válido; `quantity` ausente, não inteiro,
  ou menor que 1.
- **404 Not Found** — `productId` não corresponde a nenhum produto no `products-service`.
- **422/400 (erro de negócio)** — produto encontrado, porém com `isActive: false`.
- **502/503 (erro de dependência externa)** — `products-service` indisponível ou retornando erro
  inesperado (diferente de 404) ao buscar o produto.
- **401 Unauthorized** — requisição sem token válido (comportamento já garantido pelo guard global).

### `GET /cart`
- **200 OK** — sempre, para um usuário autenticado: retorna o carrinho ativo com itens e total, ou um
  carrinho vazio (sem itens, total zero) se o usuário não possuir carrinho ativo.
- **401 Unauthorized** — requisição sem token válido.

### `DELETE /cart/items/:itemId`
- **200 OK** — item pertencente ao carrinho do usuário autenticado, removido com sucesso: retorna o
  carrinho atualizado (itens restantes e total recalculado).
- **400 Bad Request** — `itemId` não é um UUID válido.
- **404 Not Found** — nenhum item com esse `itemId` existe, ou existe mas pertence ao carrinho de
  outro usuário.
- **401 Unauthorized** — requisição sem token válido.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — `ProductsClientService` existe, usa `HttpModule`/`@nestjs/axios`, e busca o produto em
  `GET {PRODUCTS_SERVICE_URL}/products/:id`, com a URL base lida de `PRODUCTS_SERVICE_URL` via
  `ConfigService`.
- [ ] **CA2** — Uma chamada do `ProductsClientService` para um `productId` inexistente resulta em uma
  condição de erro distinguível de "produto inativo" ou "serviço indisponível".
- [ ] **CA3** — Uma chamada do `ProductsClientService` quando o `products-service` está fora do ar (ou
  retorna erro diferente de 404) resulta em uma condição de erro distinguível de "produto não
  encontrado".
- [ ] **CA4** — `POST /cart/items` com corpo válido (`productId` de um produto existente e ativo,
  `quantity` ≥ 1), enviado com token válido, cria um `CartItem` com `productName` e `price` copiados
  do produto retornado pelo `products-service` no momento da chamada, `subtotal = price * quantity`,
  e retorna o carrinho atualizado.
- [ ] **CA5** — Repetir `POST /cart/items` com o mesmo `productId` já presente no carrinho soma a
  nova `quantity` à quantidade existente do item, recalcula o `subtotal` desse item com o `price`
  originalmente gravado (não busca um novo preço), e não cria um segundo `CartItem` para o mesmo
  produto.
- [ ] **CA6** — Após qualquer `POST /cart/items` bem-sucedido, o `total` do carrinho retornado é
  igual à soma dos `subtotal` de todos os itens do carrinho.
- [ ] **CA7** — `POST /cart/items` com `productId` ausente, com formato inválido (não-UUID), ou com
  `quantity` ausente, não inteiro ou menor que 1, retorna **400** e não realiza nenhuma chamada ao
  `products-service` nem ao banco.
- [ ] **CA8** — `POST /cart/items` com `productId` de um produto inexistente no `products-service`
  retorna **404** e não cria nem altera nenhum `CartItem`.
- [ ] **CA9** — `POST /cart/items` com `productId` de um produto existente porém com `isActive: false`
  é rejeitado com um erro de negócio e não cria nem altera nenhum `CartItem`.
- [ ] **CA10** — `POST /cart/items` quando o `products-service` está indisponível é rejeitado com um
  erro identificável como falha de dependência externa, e não cria nem altera nenhum `CartItem`.
- [ ] **CA11** — `GET /cart`, para um usuário autenticado sem nenhum carrinho `active` existente,
  retorna com sucesso um carrinho vazio (sem itens, total zero) e não cria nenhum registro de carrinho
  no banco.
- [ ] **CA12** — `GET /cart`, para um usuário autenticado com um carrinho `active` existente, retorna
  esse carrinho com seus itens e o `total` correspondente à soma dos `subtotal`.
- [ ] **CA13** — `GET /cart` de um usuário nunca retorna itens ou totais pertencentes ao carrinho de
  outro usuário.
- [ ] **CA14** — `DELETE /cart/items/:itemId` de um item existente, pertencente ao carrinho do usuário
  autenticado, remove esse item, recalcula o `total` do carrinho (soma dos `subtotal` restantes), e
  retorna o carrinho atualizado.
- [ ] **CA15** — `DELETE /cart/items/:itemId` do último item restante de um carrinho resulta em um
  carrinho com `total` igual a zero e nenhum item.
- [ ] **CA16** — `DELETE /cart/items/:itemId` com um `itemId` que não existe retorna **404**.
- [ ] **CA17** — `DELETE /cart/items/:itemId` com um `itemId` que existe mas pertence ao carrinho de
  outro usuário retorna **404** (não deve revelar a existência do item a um usuário sem permissão
  sobre ele), e não remove o item.
- [ ] **CA18** — `DELETE /cart/items/:itemId` com um `itemId` que não é um UUID válido retorna
  **400**.
- [ ] **CA19** — Um usuário nunca possui, em nenhum momento observável através destes três endpoints,
  mais de um carrinho com `status: active` simultaneamente.
- [ ] **CA20** — Um usuário com `role: seller` e um usuário com `role: buyer` conseguem, cada um,
  adicionar itens, consultar e remover itens de seu próprio carrinho através destes endpoints, sem
  distinção de comportamento baseada em `role`.
- [ ] **CA21** — Todos os três endpoints (`POST /cart/items`, `GET /cart`, `DELETE /cart/items/:itemId`)
  retornam **401** quando chamados sem um token JWT válido.
- [ ] **CA22** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Depende diretamente da spec anterior (`01 - domain-entities-and-jwt-authentication.md`): entidades
`Cart`/`CartItem` já persistidas, `CartModule` já existente (a ser estendido, não recriado), e guard
global de autenticação já ativo. Depende também do `products-service` estar no ar e expondo
publicamente `GET /products/:id` no formato já validado.

Specs futuras (fora do escopo aqui) devem cobrir, nesta ordem sugerida:
1. Checkout/finalização do carrinho: criação de uma `Order` a partir do carrinho ativo (mudando seu
   `status` para `completed`), incluindo a publicação de evento na fila de pagamentos via
   `PaymentQueueService` já existente.
2. Consulta de pedidos (`Order`) por usuário.
