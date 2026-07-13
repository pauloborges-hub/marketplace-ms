# Spec: Corrigir conflito de porta do banco do checkout-service e teste quebrado do AppController

## Contexto

O marketplace-ms é composto por múltiplos serviços NestJS, cada um com seu próprio banco PostgreSQL isolado via Docker Compose:

| Serviço | Porta do banco (host) | Arquivo compose |
|---|---|---|
| users-service | 5433 | `users-service/docker-compose.yml` |
| products-service | 5436 | `products-service/docker-compose.yml` |
| checkout-service | 5434 | `checkout-service/docker-compose.yml` |
| payments-service | 5435 | `payments-service/docker-compose.yml` |

Auditoria do estado atual do repositório (2026-07-09) encontrou o seguinte:

- **payments-service já está consistente**: `.env` tem `DB_PORT=5435` e `docker-compose.yml` expõe `5435:5432`. Nenhuma ação necessária — este item foi verificado e **removido do escopo desta spec**.
- **checkout-service usa a porta 5434**, que hoje não colide com nenhum outro serviço já que o products-service está em 5436 (e não em 5434, como uma descrição inicial do problema supunha). Ainda assim, 5434 é uma porta "livre" arbitrária que não segue o padrão sequencial dos demais serviços e não há garantia de que outro serviço/projeto na máquina do desenvolvedor não a esteja usando. Para resolver a causa raiz da forma sugerida (dar ao checkout-service uma porta própria fora da faixa já usada pelos outros três serviços) **sem introduzir um novo conflito com o products-service (5436)**, a porta escolhida é **5437**.
- **O teste `checkout-service/src/app.controller.spec.ts` está quebrado**: `AppController` depende de `PaymentQueueService` (via `PaymentOrderMessage`/RabbitMQ) mas o `TestingModule` do teste só registra `AppService`. Rodar `npx jest app.controller.spec.ts` falha com erro de resolução de dependência do Nest (`Nest can't resolve dependencies of the AppController`).

## Objetivo

1. Dar ao banco do checkout-service uma porta de host exclusiva (5437), eliminando qualquer risco de colisão com os demais serviços do projeto.
2. Corrigir o teste unitário de `AppController` para que o `TestingModule` forneça um mock de `PaymentQueueService`, permitindo que a suíte de testes do checkout-service passe novamente.

## Fora de escopo

- Qualquer alteração em `users-service` ou `products-service`.
- Qualquer alteração no `payments-service` (verificado como já consistente).
- Criação de docker-compose raiz ou Dockerfiles.
- Alterações de schema, migrations ou lógica de negócio.

## Mudanças propostas

### 1. checkout-service — porta do banco: 5434 → 5437

**Arquivo: `checkout-service/docker-compose.yml`**
```diff
     ports:
-      - "5434:5432"
+      - "5437:5432"
```

**Arquivo: `checkout-service/.env`**
```diff
-DB_PORT=5434
+DB_PORT=5437
```

**Arquivo: `checkout-service/src/config/database.config.ts`**
```diff
-  port: Number(process.env.DB_PORT) || 5434,
+  port: Number(process.env.DB_PORT) || 5437,
```

> Observação: `checkout-service/.env.example` já tem `DB_PORT=` sem valor — não requer alteração.

### 2. checkout-service — teste do AppController

**Arquivo: `checkout-service/src/app.controller.spec.ts`**

Adicionar um provider mock de `PaymentQueueService` ao `TestingModule`, seguindo o padrão de mocks do Nest (objeto com os métodos usados pelo controller, ex.: `publishPaymentOrder` como `jest.fn()`):

```diff
 import { Test, TestingModule } from '@nestjs/testing';
 import { AppController } from './app.controller';
 import { AppService } from './app.service';
+import { PaymentQueueService } from './events/payment-queue/payment-queue.service';

 describe('AppController', () => {
   let appController: AppController;

   beforeEach(async () => {
     const app: TestingModule = await Test.createTestingModule({
       controllers: [AppController],
-      providers: [AppService],
+      providers: [
+        AppService,
+        {
+          provide: PaymentQueueService,
+          useValue: {
+            publishPaymentOrder: jest.fn(),
+          },
+        },
+      ],
     }).compile();

     appController = app.get<AppController>(AppController);
   });
```

## Critérios de aceite

1. `grep -r "5434" checkout-service --include="*.yml" --include="*.env" --include="*.ts"` (excluindo `dist/`) não retorna nenhuma ocorrência.
2. `checkout-service/docker-compose.yml`, `checkout-service/.env` e `checkout-service/src/config/database.config.ts` usam `5437` como porta do banco.
3. Nenhum arquivo de `users-service` ou `products-service` foi alterado (`git diff --stat` restrito a esses diretórios está vazio).
4. `payments-service` permanece inalterado (`.env` com `DB_PORT=5435`, `docker-compose.yml` com `5435:5432`).
5. `npx jest app.controller.spec.ts` (dentro de `checkout-service`) passa com 0 falhas.
6. Subindo `docker compose up -d` em `checkout-service`, `products-service`, `payments-service` e `users-service` simultaneamente, os 4 containers de banco sobem sem erro de porta em uso (`5433`, `5434` fica livre, `5435`, `5436`, `5437` cada um mapeado a um único serviço).
7. Um único commit contém todas as alterações acima.

## Riscos e mitigação

- Qualquer desenvolvedor com uma conexão local salva apontando para `localhost:5434` (ex.: cliente SQL) precisará atualizar para `5437` após esta mudança. Isso deve ser comunicado no PR.
