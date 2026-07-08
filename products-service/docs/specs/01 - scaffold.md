# SPEC: Scaffold do products-service

> **Objetivo:** Preparar a base do microserviço `products-service` no monorepo `marketplace-ms`,
> pronto para receber a lógica de negócio do catálogo de produtos em specs futuras.
>
> **Escopo desta spec:** apenas o scaffold — infraestrutura, conexão com banco e a entidade `Product`.
> **Fora de escopo:** endpoints (REST), autenticação, regras de negócio e integração com outros serviços. Tudo isso será tratado em specs posteriores.

---

## 1. Contexto

O `marketplace-ms` é um sistema de marketplace dividido em microserviços NestJS. Os serviços já existentes são:

| Serviço              | Porta | Responsabilidade                         |
| --------------------- | ----- | ---------------------------------------- |
| api-gateway            | 3005  | Ponto de entrada / roteamento            |
| users-service           | 3000  | Gerenciamento de usuários                |
| checkout-service        | 3003  | Fluxo de checkout                        |
| payments-service        | 3004  | Processamento de pagamentos              |
| messaging-service       | —     | Infraestrutura de mensageria (RabbitMQ)  |
| **products-service**    | **3001** | **Catálogo de produtos (novo)**       |

O `products-service` será o serviço responsável por gerenciar o catálogo de produtos do marketplace. Esta spec entrega apenas o esqueleto do projeto, seguindo os mesmos padrões dos serviços já existentes (especialmente o `users-service`, o mais recente).

O projeto já foi inicializado via `@nestjs/cli` (`nest new products-service`), com as dependências de runtime (`@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `class-validator`, `class-transformer`) já instaladas. Esta spec cobre o restante da configuração do scaffold.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão de scaffold gerado pelo `@nestjs/cli`)
- **ORM:** TypeORM (`@nestjs/typeorm` + `typeorm`)
- **Banco:** PostgreSQL 15
- **Driver:** `pg`
- **Configuração:** `@nestjs/config` para carregar variáveis de ambiente
- **Validação:** `class-validator` + `class-transformer`
- **Banco local:** via Docker Compose
- **Linguagem:** TypeScript

O projeto deve ser **enxuto** — incluir apenas o essencial listado nesta spec, sem dependências ou módulos extras (é um projeto de curso).

---

## 3. Requisitos funcionais

### RF1 — Projeto NestJS com dependências necessárias
- O projeto deve ser um scaffold NestJS válido, gerado pelo CLI, seguindo a mesma estrutura dos outros serviços do monorepo.
- Deve declarar como dependências de runtime, no mínimo:
  - `@nestjs/typeorm` e `typeorm` (ORM)
  - `pg` (driver PostgreSQL)
  - `@nestjs/config` (variáveis de ambiente)
  - `class-validator` e `class-transformer` (validação)
- Os scripts padrão do NestJS (`start`, `start:dev`, `build`, `lint`, `test`) devem funcionar.

### RF2 — Docker Compose com PostgreSQL 15
- Deve existir um arquivo `docker-compose.yml` na raiz do serviço.
- O serviço de banco deve usar a imagem `postgres:15`.
- Deve expor a porta **5436** no host, mapeada para a `5432` do container (as portas 5433, 5434 e 5435 já estão em uso pelos bancos de users-service, checkout-service e payments-service, respectivamente).
- Database inicial: **`products_db`**.
- Credenciais padrão de desenvolvimento: usuário `postgres`, senha `postgres`.
- Deve usar um volume nomeado para persistência dos dados.
- Deve seguir a mesma estrutura (naming de container, network dedicada) do `docker-compose.yml` do `users-service`.

### RF3 — Conexão com banco via variáveis de ambiente
- A configuração de conexão do TypeORM deve ler todos os parâmetros de banco a partir de variáveis de ambiente, com valores default sensatos para desenvolvimento local (seguindo o padrão de `src/config/database.config.ts` do users-service).
- `synchronize` deve estar habilitado apenas fora de produção (`NODE_ENV !== 'production'`), para que a tabela seja criada automaticamente em dev.
- `logging` habilitado apenas em ambiente de desenvolvimento.
- As entidades devem ser carregadas por glob (`*.entity`), sem registro manual.
- As variáveis de ambiente devem ser carregadas globalmente (via `@nestjs/config`), disponíveis em toda a aplicação.

### RF4 — Módulo de produtos básico (sem endpoints)
- Deve existir um módulo `ProductsModule` dedicado ao domínio de produtos.
- O módulo deve registrar a entidade `Product` no TypeORM (para o repositório ficar disponível), mas **não** deve expor nenhum controller nem rota nesta spec.
- O `ProductsModule` deve ser importado pelo `AppModule`.
- Não deve conter lógica de negócio, DTOs de request nem service com regras — apenas a estrutura mínima que permita evoluir nas próximas specs.

### RF5 — ValidationPipe global
- O `ValidationPipe` deve ser habilitado globalmente no bootstrap da aplicação (`main.ts`), seguindo a mesma configuração dos demais serviços:
  - `transform: true`
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
- CORS habilitado (`app.enableCors()`), mantendo o padrão dos demais serviços.
- A aplicação deve subir na porta definida pela variável `PORT` (default **3001**) e logar uma mensagem de inicialização, no mesmo estilo dos outros serviços.

### RF6 — Arquivos de ambiente
- Deve existir um `.env.example` listando todas as variáveis necessárias (sem valores sensíveis).
- Deve existir um `.env` para desenvolvimento local com os valores default coerentes com o `docker-compose.yml`.
- O `.env` deve estar no `.gitignore`; o `.env.example` deve ser versionado.

---

## 4. Estrutura de dados

### Entidade `Product`

Tabela de produtos do catálogo. Nesta spec a entidade deve conter **exatamente** os campos abaixo — nada além disso.

| Campo         | Tipo             | Regras                                                             |
| ------------- | ---------------- | ------------------------------------------------------------------- |
| `id`          | UUID              | Chave primária, gerada automaticamente pelo banco                  |
| `name`        | string (255)      | Obrigatório                                                          |
| `description` | text              | Obrigatório                                                          |
| `price`       | decimal (10,2)    | Obrigatório                                                          |
| `stock`       | int               | **Default: `0`**                                                    |
| `sellerId`    | UUID              | Obrigatório. Referência ao usuário vendedor no `users-service` — **sem foreign key** no banco, pois é um banco de dados separado |
| `isActive`    | boolean           | **Default: `true`**                                                 |
| `createdAt`   | timestamp         | Preenchido automaticamente na criação                               |
| `updatedAt`   | timestamp         | Atualizado automaticamente a cada alteração                         |

**Observações:**
- `sellerId` não possui constraint de foreign key, pois `products-service` e `users-service` têm bancos de dados independentes — a validação de que o vendedor existe será tratada em spec futura.
- Não incluir soft-delete, relacionamentos, índices adicionais ou colunas extras nesta spec.

---

## 5. Variáveis de ambiente

| Variável      | Descrição                | Valor default (dev) |
| ------------- | -------------------------- | -------------------- |
| `PORT`        | Porta HTTP do serviço       | `3001`                |
| `NODE_ENV`    | Ambiente de execução        | `development`         |
| `DB_HOST`     | Host do PostgreSQL          | `localhost`           |
| `DB_PORT`     | Porta do PostgreSQL         | `5436`                |
| `DB_USERNAME` | Usuário do banco            | `postgres`             |
| `DB_PASSWORD` | Senha do banco              | `postgres`             |
| `DB_DATABASE` | Nome do database            | `products_db`          |

> As variáveis de banco devem ser coerentes entre `.env`, `docker-compose.yml` e a configuração do TypeORM.

---

## 6. Estrutura de pastas esperada

```
products-service/
├── docker-compose.yml
├── .env
├── .env.example
├── nest-cli.json
├── package.json
├── tsconfig.json
├── docs/
│   └── specs/
│       └── scaffold.md          # esta spec
└── src/
    ├── main.ts                  # bootstrap + ValidationPipe global + CORS
    ├── app.module.ts            # importa ConfigModule, TypeOrmModule e ProductsModule
    ├── app.controller.ts        # (padrão do scaffold)
    ├── app.service.ts           # (padrão do scaffold)
    ├── config/
    │   └── database.config.ts   # configuração do TypeORM via env
    └── products/
        ├── products.module.ts   # registra a entidade Product (sem controller)
        └── entities/
            └── product.entity.ts # entidade Product
```

> A estrutura acima segue o padrão do `users-service` (pasta `src/config`, módulo de domínio dedicado). Não é obrigatório reproduzir nomes de arquivo idênticos, desde que a organização e a separação de responsabilidades sejam equivalentes.

---

## 7. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [x] **CA1** — `npm install` na pasta `products-service` conclui sem erros e instala `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `class-validator` e `class-transformer`.
- [x] **CA2** — `docker compose up -d` sobe um container PostgreSQL 15 acessível em `localhost:5436` com o database `products_db` criado.
- [x] **CA3** — Com o banco no ar e o `.env` configurado, `npm run start:dev` inicia a aplicação sem erros de conexão e loga a mensagem de inicialização na porta `3001`.
- [x] **CA4** — Ao iniciar em ambiente de desenvolvimento (`synchronize: true`), a tabela de produtos é criada automaticamente no banco com todas as colunas descritas na seção 4, incluindo os defaults de `stock` (`0`) e `isActive` (`true`) e os timestamps automáticos.
- [x] **CA5** — A coluna `sellerId` existe como UUID simples, sem constraint de foreign key no banco.
- [x] **CA6** — A aplicação **não** expõe nenhum endpoint de produtos (apenas as rotas padrão do scaffold, se houver) — confirmando que nenhuma lógica de negócio foi adicionada.
- [x] **CA7** — O `ValidationPipe` global está habilitado no bootstrap com `transform`, `whitelist` e `forbidNonWhitelisted`.
- [x] **CA8** — Todas as variáveis de ambiente da seção 5 estão documentadas no `.env.example`, e o `.env` real está ignorado pelo Git.
- [x] **CA9** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 8. Dependências e sequência

Esta é a **primeira spec** do `products-service`. Não depende de nenhuma outra spec.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. CRUD de produtos (endpoints REST + DTOs + service).
2. Validação de que `sellerId` corresponde a um vendedor existente (integração com `users-service`).
3. Integração com o `api-gateway`.
