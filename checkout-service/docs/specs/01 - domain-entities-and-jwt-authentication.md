# SPEC: Entidades de domínio (`Cart`, `CartItem`, `Order`) e autenticação JWT no `checkout-service`

> **Objetivo:** Dar ao `checkout-service` um modelo de dados persistido (carrinho e pedido) e a
> mesma camada de proteção por JWT já validada no `users-service` e no `products-service`, para que
> as próximas specs possam construir endpoints de negócio sobre uma base sólida e protegida por
> padrão.
>
> **Escopo desta spec:** entidades TypeORM `Cart`, `CartItem` e `Order`; módulos `CartModule` e
> `OrdersModule` responsáveis apenas por registrar essas entidades no TypeORM; `AuthModule` com
> `JwtStrategy`, `JwtAuthGuard` global e decorator `@Public()`; um endpoint público de health check;
> Swagger básico.
> **Fora de escopo:** qualquer endpoint CRUD ou de negócio para carrinho ou pedido (controllers,
> services, DTOs de request/response) — isso será tratado em specs futuras. Controle de acesso por
> papel/role. Emissão, assinatura ou refresh de tokens. Alterações no `EventsModule` (RabbitMQ)
> existente — ele deve permanecer exatamente como está.

---

## 1. Contexto

O `checkout-service` (porta 3003) já possui hoje:

- Scaffold NestJS funcional, com `AppModule`, `AppController`/`AppService` gerados pelo CLI.
- Conexão com PostgreSQL configurada via `TypeOrmModule.forRoot`, banco `checkout_db`.
- `EventsModule`, com `PaymentQueueService` e `RabbitMQService`, já integrado ao RabbitMQ.
- `ConfigModule` global, lendo variáveis de `.env`.
- `ValidationPipe` global habilitado no `main.ts`.
- As dependências de autenticação (`@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, e
  o pacote de tipos `@types/passport-jwt`) já constam no `package.json`, mas **não são usadas em
  lugar nenhum** — não existe `AuthModule`, `JwtStrategy`, guard ou decorator no serviço.
- Uma variável `JWT_SECRET` já existe no `.env`/`.env.example`, mas com um valor de placeholder que
  **não** corresponde ao valor real usado pelo `users-service`.

O que o `checkout-service` **não** possui:

- Nenhuma entidade de domínio: a pasta `entities` referenciada em `TypeOrmModuleOptions.entities`
  (`config/database.config.ts`) hoje não casa com nenhum arquivo `*.entity.ts`, então o TypeORM não
  cria tabela alguma no `checkout_db` ao subir o serviço.
- Nenhum mecanismo de autenticação ativo: todas as rotas do serviço estão, hoje, completamente
  abertas.

O `users-service` (porta 3000) já possui um fluxo de login funcional e emite tokens JWT assinados
com o payload `{ sub: UUID, email: string, role: "seller" | "buyer" }`, usando um secret configurado
em `JWT_SECRET`. O `products-service` (porta 3001) já implementou, em spec própria, a validação
desse token com `AuthModule` + `JwtStrategy` + `JwtAuthGuard` global + decorator `@Public()`. Esta
spec reaproveita exatamente essa mesma abordagem no `checkout-service`.

Em paralelo, esta spec também estabelece o modelo de dados mínimo do fluxo de checkout: um carrinho
de compras (`Cart`) composto por itens (`CartItem`), e um pedido (`Order`) originado a partir de um
carrinho.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos demais serviços do monorepo).
- **ORM:** TypeORM, já configurado no serviço (`@nestjs/typeorm` + `typeorm` + `pg`).
- **Estratégia de autenticação:** `passport-jwt`, integrada via `@nestjs/passport` — mesma
  biblioteca e abordagem já usada no `users-service` e no `products-service`.
- **Guard global:** registrado via token `APP_GUARD` do NestJS, aplicado automaticamente a todas as
  rotas do serviço.
- **Metadata de rota:** mecanismo nativo do NestJS (`Reflector` + decorator customizado) para marcar
  rotas como públicas — sem libs adicionais.
- **Secret compartilhado:** o `checkout-service` **não gera** o secret — deve usar exatamente o
  mesmo valor de `JWT_SECRET` já configurado no `users-service`.
- **Documentação de API:** Swagger, via `@nestjs/swagger` (ainda não presente no `package.json` do
  `checkout-service` — precisa ser adicionado).
- **Paridade de implementação:** a estrutura de pastas, nomes de classes e organização do código de
  autenticação devem seguir o mesmo padrão usado no `AuthModule` do `products-service` (estratégia,
  guard e decorator organizados em subpastas dedicadas), adaptado ao fato de que o
  `checkout-service` também não possui `AuthController` nem `AuthService`.
- O projeto deve continuar **enxuto** — sem dependências, endpoints ou abstrações além do necessário
  para esta spec.

---

## 3. Requisitos funcionais

### RF1 — Entidade `Cart`
- Deve existir uma entidade TypeORM representando o carrinho de compras.
- Campos:
  - `id`: identificador único (UUID), gerado automaticamente.
  - `userId`: UUID do usuário dono do carrinho.
  - `status`: enum com os valores `active`, `completed` e `abandoned`, com valor padrão `active`.
  - `total`: valor decimal (precisão 10, escala 2), representando a soma dos subtotais dos itens,
    com valor padrão `0`.
  - `items`: relação um-para-muitos com `CartItem`, configurada com cascade (operações de escrita no
    carrinho propagam para os itens) e carregamento eager (os itens são carregados automaticamente
    junto com o carrinho, sem necessidade de `relations` explícito na consulta).
  - `createdAt`: data de criação, preenchida automaticamente.
  - `updatedAt`: data da última atualização, preenchida automaticamente.
- Nenhum outro campo, índice ou relação além dos listados deve ser adicionado nesta spec.

### RF2 — Entidade `CartItem`
- Deve existir uma entidade TypeORM representando um item dentro de um carrinho.
- Campos:
  - `id`: identificador único (UUID), gerado automaticamente.
  - `cart`: relação muitos-para-um com `Cart`, com exclusão em cascata (`onDelete: CASCADE`) — ao
    excluir um carrinho, seus itens são excluídos junto.
  - `cartId`: coluna de UUID correspondente à chave estrangeira da relação com `Cart`.
  - `productId`: UUID do produto referenciado (dado vindo do `products-service`; nenhuma relação de
    chave estrangeira com uma tabela local de produtos deve ser criada, já que o catálogo não vive
    neste serviço).
  - `productName`: nome do produto no momento em que foi adicionado ao carrinho (texto, até 255
    caracteres) — mantido aqui como cópia para preservar o histórico mesmo que o produto mude de
    nome depois.
  - `price`: valor unitário decimal (precisão 10, escala 2) do produto no momento em que foi
    adicionado ao carrinho.
  - `quantity`: quantidade inteira do item, com valor padrão `1`.
  - `subtotal`: valor decimal (precisão 10, escala 2) correspondente a `price * quantity` no momento
    do registro.
  - `createdAt`: data de criação, preenchida automaticamente.
- Nenhum outro campo, índice ou relação além dos listados deve ser adicionado nesta spec.
- Esta spec cobre apenas a definição da entidade e sua persistência — o cálculo de `subtotal` e a
  sincronização do `total` do carrinho a partir dos itens **não** fazem parte desta spec (não há
  service/lógica de negócio aqui, apenas o modelo de dados).

### RF3 — Entidade `Order`
- Deve existir uma entidade TypeORM representando um pedido gerado a partir de um carrinho.
- Campos:
  - `id`: identificador único (UUID), gerado automaticamente.
  - `userId`: UUID do usuário dono do pedido.
  - `cartId`: UUID do carrinho de origem do pedido.
  - `total`: valor decimal (precisão 10, escala 2) do pedido.
  - `status`: enum com os valores `pending`, `paid`, `failed` e `cancelled`, com valor padrão
    `pending`.
  - `paymentMethod`: texto (até 50 caracteres) identificando o método de pagamento escolhido.
  - `createdAt`: data de criação, preenchida automaticamente.
  - `updatedAt`: data da última atualização, preenchida automaticamente.
- Nenhum outro campo, índice ou relação além dos listados deve ser adicionado nesta spec.
- `cartId` é armazenado como referência simples (UUID), não como relação TypeORM com `Cart` — o
  pedido deve poder ser consultado de forma independente do carrinho.

### RF4 — Módulo `CartModule`
- Deve existir um `CartModule` dedicado, responsável por registrar as entidades `Cart` e `CartItem`
  no TypeORM (`TypeOrmModule.forFeature`), tornando seus repositórios disponíveis para injeção em
  código de specs futuras.
- O `CartModule` **não** deve conter controller, service, DTO ou qualquer endpoint nesta spec — sua
  única responsabilidade aqui é registrar as entidades.
- O `CartModule` deve ser importado pelo `AppModule`.

### RF5 — Módulo `OrdersModule`
- Deve existir um `OrdersModule` dedicado, responsável por registrar a entidade `Order` no TypeORM
  (`TypeOrmModule.forFeature`), tornando seu repositório disponível para injeção em código de specs
  futuras.
- O `OrdersModule` **não** deve conter controller, service, DTO ou qualquer endpoint nesta spec —
  sua única responsabilidade aqui é registrar a entidade.
- O `OrdersModule` deve ser importado pelo `AppModule`.

### RF6 — Estratégia de validação de token (`JwtStrategy`)
- O sistema deve validar tokens JWT recebidos no header `Authorization`, no formato
  `Bearer <token>`.
- A extração do token do header deve ser automática, sem exigir que cada endpoint implemente essa
  lógica manualmente.
- A assinatura do token deve ser validada contra o mesmo secret usado pelo `users-service` para
  assinar o token, configurado no `checkout-service` através da variável de ambiente `JWT_SECRET`
  já existente (ver RF10).
- A expiração do token (`exp`) deve ser validada automaticamente; um token expirado deve ser tratado
  como inválido.
- Um token com assinatura inválida (adulterado ou assinado com secret diferente) deve ser tratado
  como inválido.
- A partir de um token válido, o sistema deve extrair do payload os campos `sub`, `email` e `role`,
  e disponibilizá-los como um objeto de usuário autenticado contendo, no mínimo, `id` (a partir de
  `sub`), `email` e `role`.
- Esse objeto deve ficar disponível para o controller e para código downstream através da
  requisição (`req.user`), em qualquer rota protegida.
- A estratégia não deve fazer nenhuma consulta a banco de dados nem chamada remota ao
  `users-service` para validar o token; a validação é feita inteiramente a partir da assinatura e do
  payload do próprio JWT.
- O `checkout-service` não deve, em nenhum momento, gerar, assinar ou reemitir tokens — apenas
  validar tokens já emitidos pelo `users-service`.

### RF7 — Marcação de rotas públicas (`@Public()`)
- O sistema deve fornecer um mecanismo (decorator) para marcar uma rota (ou um controller inteiro)
  como pública, ou seja, não exigindo autenticação.
- Essa marcação deve ser feita através de metadata associada à rota, seguindo o mecanismo nativo do
  NestJS para esse tipo de anotação.
- A ausência dessa marcação em uma rota implica, por padrão, que ela exige autenticação.

### RF8 — Guard global de autenticação (`JwtAuthGuard`)
- O sistema deve aplicar verificação de autenticação a **todas** as rotas do serviço, de forma
  automática e centralizada, sem exigir que cada controller ou rota aplique um guard manualmente.
- Para cada requisição, o guard deve primeiro verificar se a rota (ou o handler) está marcada como
  pública (RF7).
  - Se a rota for pública, a requisição deve prosseguir normalmente, sem exigir nem validar token
    algum.
  - Se a rota não for pública, o guard deve exigir um token JWT válido, delegando a validação à
    estratégia descrita em RF6.
- Se a validação do token falhar (token ausente, expirado, malformado ou com assinatura inválida) em
  uma rota não pública, a requisição deve ser rejeitada antes de chegar ao controller.
- Se a validação do token for bem-sucedida, os dados do usuário autenticado (RF6) devem estar
  disponíveis para o controller antes da execução do handler.

### RF9 — Módulo de autenticação (`AuthModule`)
- Deve existir um `AuthModule` dedicado, responsável por registrar `JwtStrategy` e disponibilizar o
  `JwtAuthGuard` como guard global (via `APP_GUARD`).
- O `AuthModule` deve ser importado pelo `AppModule`.
- O `AuthModule` **não** deve conter `AuthController`, `AuthService` nem qualquer endpoint — sua
  única responsabilidade é a validação de tokens e a proteção de rotas.

### RF10 — Variável de ambiente do secret compartilhado
- A variável `JWT_SECRET`, já presente no `.env` e no `.env.example` do `checkout-service`, deve
  passar a ter, em ambiente de desenvolvimento, valor **idêntico** ao configurado em `JWT_SECRET` no
  `users-service` — caso contrário, nenhum token emitido pelo `users-service` será validado com
  sucesso pelo `checkout-service`.
- Nenhuma outra variável de ambiente relacionada a autenticação é necessária nesta spec, já que o
  `checkout-service` não assina tokens.

### RF11 — Dependência do Swagger
- O `checkout-service` deve passar a declarar `@nestjs/swagger` como dependência de runtime.
- Nenhuma outra dependência relacionada à documentação de API deve ser adicionada.

### RF12 — Endpoint público de health check
- Deve existir um endpoint `GET /health`, marcado explicitamente como público (RF7), acessível sem
  token.
- A resposta desse endpoint deve ser um objeto contendo `status` com o valor `"ok"` e `service` com
  o valor `"checkout-service"`.
- Esse endpoint serve como verificação de que o serviço está no ar e, simultaneamente, como
  demonstração de que uma rota pode ser pública mesmo com o guard global ativo.

### RF13 — Documentação Swagger básica
- O `checkout-service` deve expor documentação Swagger da API, configurada no bootstrap do serviço
  (`main.ts`), seguindo o mesmo padrão já usado no `products-service` (título, descrição e versão do
  serviço, com suporte a autenticação via Bearer token na UI do Swagger).
- Esta spec cobre apenas a configuração básica do Swagger — nenhum endpoint de negócio existe ainda
  para ser documentado nele.

### RF14 — Registro no `AppModule`
- O `AppModule` deve importar `CartModule`, `OrdersModule` e `AuthModule`.
- O `AppModule` deve registrar o `JwtAuthGuard` como guard global, via `APP_GUARD`.
- O `EventsModule` já existente e sua ordem/configuração atual não devem ser alterados por esta
  spec, além do necessário para conviver com os novos imports.
- A rota padrão gerada pelo scaffold do NestJS (`AppController`) não deve ser marcada como pública —
  ela passa a exigir token válido como qualquer outra rota, servindo como demonstração adicional de
  que o guard global está ativo por padrão.

---

## 4. Fluxo esperado de uma requisição

1. A requisição chega a um endpoint qualquer do `checkout-service`.
2. O `JwtAuthGuard` (global) intercepta a requisição antes de qualquer controller.
3. O guard verifica, via metadata, se a rota (ou handler) foi marcada com `@Public()`.
   - **Se sim** (ex.: `GET /health`): a requisição segue direto para o controller, sem checagem de
     token.
   - **Se não**: o guard aciona a validação de token (RF6):
     a. Extrai o token do header `Authorization` (formato `Bearer <token>`).
     b. Se o header estiver ausente ou não seguir o formato esperado, a requisição é rejeitada.
     c. Se o token estiver presente, sua assinatura (contra o `JWT_SECRET` do `checkout-service`) e
        expiração são validadas.
     d. Se a validação falhar (por qualquer motivo), a requisição é rejeitada.
     e. Se a validação for bem-sucedida, os dados do usuário (`id`, `email`, `role`) são anexados à
        requisição (`req.user`).
4. Apenas requisições que passaram pela verificação (públicas, ou autenticadas com sucesso) chegam
   ao controller correspondente.

---

## 5. Respostas esperadas

### Rota pública (`GET /health`)
- Acessível sem qualquer token, retornando `{ status: "ok", service: "checkout-service" }`.

### Rotas protegidas (qualquer rota não marcada como `@Public()`, incluindo a rota padrão do
scaffold)

- **401 Unauthorized**, quando:
  - O header `Authorization` está ausente.
  - O header `Authorization` está presente mas não segue o formato `Bearer <token>`.
  - O token está presente mas expirado.
  - O token está presente mas com assinatura inválida (adulterado, ou assinado com um secret
    diferente do configurado em `JWT_SECRET` no `checkout-service`).
  - O token está malformado (não é um JWT válido).
- **Resposta normal do handler**, quando o token é válido — o controller é executado normalmente e
  `req.user` contém os dados do usuário autenticado (`id`, `email`, `role`).
- Em nenhum cenário de erro (401) o handler da rota deve ser executado.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Ao subir o `checkout-service` com `synchronize` ativo (ambiente de desenvolvimento)
  contra o `checkout_db`, são criadas as tabelas correspondentes a `Cart`, `CartItem` e `Order`, com
  todas as colunas descritas em RF1, RF2 e RF3.
- [ ] **CA2** — A tabela de `Cart` possui uma coluna `status` restrita aos valores `active`,
  `completed` e `abandoned`, com `active` como padrão quando não informado.
- [ ] **CA3** — A tabela de `Order` possui uma coluna `status` restrita aos valores `pending`,
  `paid`, `failed` e `cancelled`, com `pending` como padrão quando não informado.
- [ ] **CA4** — Ao carregar um `Cart` pelo seu repositório TypeORM, seus `CartItem`s são carregados
  automaticamente (eager), sem necessidade de especificar `relations` na consulta.
- [ ] **CA5** — Ao remover um `Cart` que possua `CartItem`s associados, os `CartItem`s
  correspondentes são removidos automaticamente (comportamento de `onDelete: CASCADE`).
- [ ] **CA6** — `CartModule` e `OrdersModule` existem, cada um importando `TypeOrmModule.forFeature`
  com suas respectivas entidades, e nenhum dos dois expõe controller, service ou endpoint.
- [ ] **CA7** — `npm install` na pasta `checkout-service` conclui sem erros; `@nestjs/jwt`,
  `@nestjs/passport`, `passport`, `passport-jwt` e `@nestjs/swagger` constam como dependências de
  runtime, e `@types/passport-jwt` como dependência de desenvolvimento.
- [ ] **CA8** — A variável `JWT_SECRET` no `.env` do `checkout-service` tem o mesmo valor usado pelo
  `users-service`.
- [ ] **CA9** — Uma requisição a uma rota protegida do `checkout-service` (incluindo a rota padrão do
  scaffold) sem header `Authorization` retorna **401 Unauthorized**.
- [ ] **CA10** — Uma requisição a uma rota protegida com header `Authorization` presente mas fora do
  formato `Bearer <token>` retorna **401 Unauthorized**.
- [ ] **CA11** — Uma requisição a uma rota protegida com um token expirado retorna **401
  Unauthorized**.
- [ ] **CA12** — Uma requisição a uma rota protegida com um token assinado com um secret diferente do
  configurado em `JWT_SECRET` retorna **401 Unauthorized**.
- [ ] **CA13** — Uma requisição a uma rota protegida com um token malformado retorna **401
  Unauthorized**.
- [ ] **CA14** — Um token válido, obtido através do `POST /auth/login` do `users-service`, é aceito
  pelo `checkout-service`: uma requisição a uma rota protegida com esse token no header
  `Authorization` é processada normalmente, sem retornar 401.
- [ ] **CA15** — No cenário do CA14, o objeto disponível em `req.user` contém `id`, `email` e `role`,
  com valores correspondentes ao payload do token (`sub`, `email`, `role` respectivamente).
- [ ] **CA16** — `GET /health` é acessível sem token e retorna
  `{ status: "ok", service: "checkout-service" }`.
- [ ] **CA17** — O guard de autenticação é aplicado globalmente: qualquer rota nova, criada sem
  nenhuma anotação especial, exige token por padrão.
- [ ] **CA18** — A documentação Swagger do serviço está acessível e reflete o título/descrição do
  `checkout-service`, com suporte a autenticação Bearer configurado.
- [ ] **CA19** — O `EventsModule` e a integração com RabbitMQ continuam funcionando exatamente como
  antes, sem alterações de comportamento.
- [ ] **CA20** — O `checkout-service` não expõe nenhum endpoint de `login`, `register`, CRUD de
  carrinho/pedido ou qualquer outra rota de negócio além do `GET /health` e da rota padrão do
  scaffold.
- [ ] **CA21** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 7. Dependências e sequência

Depende do scaffold já existente do `checkout-service` (conexão com PostgreSQL, `ConfigModule`,
`EventsModule`) e, externamente, do fluxo de login já implementado no `users-service`, de onde vêm o
formato do payload (`sub`, `email`, `role`) e o valor de `JWT_SECRET` a ser replicado. Reaproveita
diretamente o padrão de autenticação já validado na spec de JWT do `products-service`.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. CRUD de carrinho (`CartModule`: endpoints REST + DTOs + service para adicionar/remover itens,
   consultar e finalizar o carrinho), já protegido por padrão graças a esta spec.
2. Criação de pedido a partir de um carrinho (`OrdersModule`: endpoint de checkout, DTOs e service),
   incluindo a publicação de evento na fila de pagamentos via `PaymentQueueService` já existente.
3. Consulta de pedidos por usuário.
