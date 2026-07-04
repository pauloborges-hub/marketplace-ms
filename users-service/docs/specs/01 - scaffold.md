# SPEC: Scaffold do users-service

> **Objetivo:** Preparar a base do microserviço `users-service` no monorepo `marketplace-ms`,
> pronto para receber a lógica de negócio de gerenciamento de usuários em specs futuras.
>
> **Escopo desta spec:** apenas o scaffold — infraestrutura, conexão com banco e a entidade `User`.
> **Fora de escopo:** endpoints (REST), autenticação/JWT, hashing de senha, regras de negócio e integração com outros serviços. Tudo isso será tratado em specs posteriores.

---

## 1. Contexto

O `marketplace-ms` é um sistema de marketplace dividido em microserviços NestJS. Os serviços já existentes são:

| Serviço            | Porta | Responsabilidade                         |
| ------------------ | ----- | ---------------------------------------- |
| api-gateway        | 3005  | Ponto de entrada / roteamento            |
| checkout-service   | 3003  | Fluxo de checkout                        |
| payments-service   | 3004  | Processamento de pagamentos              |
| messaging-service  | —     | Infraestrutura de mensageria (RabbitMQ)  |
| **users-service**  | **3000** | **Gerenciamento de usuários (novo)**  |

O `users-service` será o serviço responsável por gerenciar os usuários do marketplace. Esta spec entrega apenas o esqueleto do projeto, seguindo os mesmos padrões dos serviços já existentes (especialmente o `payments-service`, o mais recente).

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
- Deve expor a porta **5433** no host, mapeada para a `5432` do container (a porta 5433 evita conflito com os bancos dos outros serviços — o payments-service usa 5435).
- Database inicial: **`users_db`**.
- Credenciais padrão de desenvolvimento: usuário `postgres`, senha `postgres`.
- Deve usar um volume nomeado para persistência dos dados.
- Deve seguir a mesma estrutura (naming de container, network dedicada) do `docker-compose.yml` do `payments-service`.

### RF3 — Conexão com banco via variáveis de ambiente
- A configuração de conexão do TypeORM deve ler todos os parâmetros de banco a partir de variáveis de ambiente, com valores default sensatos para desenvolvimento local (seguindo o padrão de `src/config/database.config.ts` do payments-service).
- `synchronize` deve estar habilitado apenas fora de produção (`NODE_ENV !== 'production'`), para que a tabela seja criada automaticamente em dev.
- `logging` habilitado apenas em ambiente de desenvolvimento.
- As entidades devem ser carregadas por glob (`*.entity`), sem registro manual.
- As variáveis de ambiente devem ser carregadas globalmente (via `@nestjs/config`), disponíveis em toda a aplicação.

### RF4 — Módulo de usuários básico (sem endpoints)
- Deve existir um módulo `UsersModule` dedicado ao domínio de usuários.
- O módulo deve registrar a entidade `User` no TypeORM (para o repositório ficar disponível), mas **não** deve expor nenhum controller nem rota nesta spec.
- O `UsersModule` deve ser importado pelo `AppModule`.
- Não deve conter lógica de negócio, DTOs de request nem service com regras — apenas a estrutura mínima que permita evoluir nas próximas specs.

### RF5 — ValidationPipe global
- O `ValidationPipe` deve ser habilitado globalmente no bootstrap da aplicação (`main.ts`), seguindo a mesma configuração do payments-service:
  - `transform: true`
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
- CORS habilitado (`app.enableCors()`), mantendo o padrão dos demais serviços.
- A aplicação deve subir na porta definida pela variável `PORT` (default **3000**) e logar uma mensagem de inicialização, no mesmo estilo dos outros serviços.

### RF6 — Arquivos de ambiente
- Deve existir um `.env.example` listando todas as variáveis necessárias (sem valores sensíveis).
- Deve existir um `.env` para desenvolvimento local com os valores default coerentes com o `docker-compose.yml`.
- O `.env` deve estar no `.gitignore`; o `.env.example` deve ser versionado.

---

## 4. Estrutura de dados

### Entidade `User`

Tabela de usuários. Nesta spec a entidade deve conter **exatamente** os campos abaixo — nada além disso.

| Campo       | Tipo             | Regras                                                        |
| ----------- | ---------------- | ------------------------------------------------------------ |
| `id`        | UUID             | Chave primária, gerada automaticamente pelo banco            |
| `email`     | string           | Obrigatório, **único**                                       |
| `password`  | string           | Obrigatório (armazenará o hash — o hashing virá em spec futura) |
| `firstName` | string           | Obrigatório                                                  |
| `lastName`  | string           | Obrigatório                                                  |
| `role`      | enum             | Valores possíveis: `seller`, `buyer`. Obrigatório           |
| `status`    | enum             | Valores possíveis: `active`, `inactive`. **Default: `active`** |
| `createdAt` | timestamp        | Preenchido automaticamente na criação                        |
| `updatedAt` | timestamp        | Atualizado automaticamente a cada alteração                  |

**Observações:**
- Os enums `role` e `status` devem ser definidos como enums TypeScript/PostgreSQL (não como strings livres).
- O campo `email` deve ter constraint de unicidade no banco.
- Não incluir soft-delete, relacionamentos, índices adicionais ou colunas extras nesta spec.

---

## 5. Variáveis de ambiente

| Variável      | Descrição                          | Valor default (dev) |
| ------------- | ---------------------------------- | ------------------- |
| `PORT`        | Porta HTTP do serviço              | `3000`              |
| `NODE_ENV`    | Ambiente de execução               | `development`       |
| `DB_HOST`     | Host do PostgreSQL                  | `localhost`         |
| `DB_PORT`     | Porta do PostgreSQL                 | `5433`              |
| `DB_USERNAME` | Usuário do banco                    | `postgres`          |
| `DB_PASSWORD` | Senha do banco                      | `postgres`          |
| `DB_DATABASE` | Nome do database                    | `users_db`          |

> As variáveis de banco devem ser coerentes entre `.env`, `docker-compose.yml` e `database.config.ts`.

---

## 6. Estrutura de pastas esperada

```
users-service/
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
    ├── app.module.ts            # importa ConfigModule, TypeOrmModule e UsersModule
    ├── app.controller.ts        # (padrão do scaffold)
    ├── app.service.ts           # (padrão do scaffold)
    ├── config/
    │   └── database.config.ts   # configuração do TypeORM via env
    └── users/
        ├── users.module.ts      # registra a entidade User (sem controller)
        └── entities/
            └── user.entity.ts   # entidade User
```

> A estrutura acima segue o padrão do `payments-service` (pasta `src/config`, módulo de domínio dedicado). Não é obrigatório reproduzir nomes de arquivo idênticos, desde que a organização e a separação de responsabilidades sejam equivalentes.

---

## 7. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — `npm install` na pasta `users-service` conclui sem erros e instala `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `class-validator` e `class-transformer`.
- [ ] **CA2** — `docker compose up -d` sobe um container PostgreSQL 15 acessível em `localhost:5433` com o database `users_db` criado.
- [ ] **CA3** — Com o banco no ar e o `.env` configurado, `npm run start:dev` inicia a aplicação sem erros de conexão e loga a mensagem de inicialização na porta `3000`.
- [ ] **CA4** — Ao iniciar em ambiente de desenvolvimento (`synchronize: true`), a tabela de usuários é criada automaticamente no banco com todas as colunas descritas na seção 4 (incluindo os tipos enum de `role` e `status` e os timestamps automáticos).
- [ ] **CA5** — A coluna `email` possui constraint de unicidade no banco.
- [ ] **CA6** — A coluna `status` assume `active` como valor default quando não informado.
- [ ] **CA7** — A aplicação **não** expõe nenhum endpoint de usuários (apenas as rotas padrão do scaffold, se houver) — confirmando que nenhuma lógica de negócio foi adicionada.
- [ ] **CA8** — O `ValidationPipe` global está habilitado no bootstrap com `transform`, `whitelist` e `forbidNonWhitelisted`.
- [ ] **CA9** — Todas as variáveis de ambiente da seção 5 estão documentadas no `.env.example`, e o `.env` real está ignorado pelo Git.
- [ ] **CA10** — `npm run build` compila o projeto sem erros de TypeScript.

---

## 8. Dependências e sequência

Esta é a **primeira spec** do `users-service`. Não depende de nenhuma outra spec.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. CRUD de usuários (endpoints REST + DTOs + service).
2. Hashing de senha (ex.: `bcryptjs`) e regras de criação.
3. Autenticação/JWT e integração com o `api-gateway`.
