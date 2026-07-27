# SPEC: Health check avançado com `@nestjs/terminus` (PostgreSQL)

> **Status:** Proposta
> **Serviço:** `products-service` (porta `3001`)
> **Objetivo:** Substituir o `GET /health` estático por um health check **real**, que verifique a
> disponibilidade do PostgreSQL via `TypeOrmHealthIndicator` e devolva **503** quando a dependência
> estiver fora.
>
> **Fora de escopo:** readiness/liveness probes (conceito de Kubernetes — não implementar);
> notificações externas de alerta; alteração de qualquer métrica existente; regras de alerta no
> Prometheus (ver spec `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`).

---

## 1. Contexto atual (fatos verificados no código)

| Item | Situação hoje |
|---|---|
| Endpoint | `GET /health` em `src/app.controller.ts`, decorado com `@Public()` |
| Implementação | `AppService.getHealth()` retorna literal `{ status: 'ok', service: 'products-service' }` |
| Verificação de dependências | **Nenhuma** — responde `200` mesmo com o Postgres fora do ar |
| Banco | TypeORM/Postgres, `TypeOrmModule.forRoot(databaseConfig)` em `AppModule`; `localhost:5436`, database `products_db` |
| Guard global | `JwtAuthGuard` via `APP_GUARD` em `AppModule`; rotas liberadas com `@Public()` (`src/auth/decorators/public.decorator.ts`) |
| Métricas | `HttpMetricsMiddleware` aplicado a `*`; conta toda requisição em `http_requests_total`, exceto `/metrics` |

**Consumidores externos do endpoint:**
1. O `api-gateway` chama `GET http://localhost:3001/health`
   (`api-gateway/src/common/health/health-check.service.ts`) e avalia **apenas o status HTTP**.
2. O `checkout-service` conversa com este serviço via `ProductsClientService`, mas **não** consome
   `/health`.

Nenhum consumidor lê o corpo da resposta — a mudança de formato desta spec não quebra integrações.

---

## 2. Dependência

```bash
npm install @nestjs/terminus
```

- Versão `^11.0.0` (compatível com `@nestjs/core` 11.x já instalado).
- `@nestjs/typeorm`, `typeorm` e `pg` **já estão instalados**; nada mais é necessário.
- **Não** instalar `@nestjs/axios` — este serviço não faz health check HTTP de terceiros.

---

## 3. Estrutura de arquivos

```
src/health/
├── health.module.ts
└── health.controller.ts
```

---

## 4. Requisitos funcionais

### RF1 — `HealthModule`
- Importa `TerminusModule`; declara `HealthController` em `controllers`.
- Não precisa importar `TypeOrmModule` — a conexão default registrada no `AppModule` já é global e o
  `TypeOrmHealthIndicator` resolve o `DataSource` default.
- Importado no array `imports` do `AppModule` (`src/app.module.ts`), sem alterar nada mais lá
  (guards, `ProductsModule`, `MetricsModule` permanecem intactos).

### RF2 — `HealthController`
- `@Controller('health')` + `@Get()` → `GET /health`.
- Decorado com `@Public()` — sem isso o `JwtAuthGuard` global devolve 401 e o gateway passa a
  classificar o serviço como `unhealthy`.
- Handler decorado com `@HealthCheck()`.
- Um único indicador, com chave **`database`**:

```ts
@Public()
@Get()
@HealthCheck()
check() {
  return this.health.check([
    () => this.db.pingCheck('database', { timeout: 1500 }),
  ]);
}
```

- `timeout: 1500` (ms) obrigatório — evita que um Postgres que aceita TCP mas não responde deixe o
  `/health` pendurado e bloqueie o gateway.

### RF3 — Remoção do health antigo
- Remover o handler `getHealth()` de `src/app.controller.ts` e o método `getHealth()` de
  `src/app.service.ts`. Dois handlers para a mesma rota fariam o Nest resolver para o primeiro
  registrado, ignorando silenciosamente a verificação real.
- `GET /` (`getHello`) permanece inalterado.

### RF4 — Contrato de resposta

**200 — banco operante**
```json
{
  "status": "ok",
  "info":    { "database": { "status": "up" } },
  "error":   {},
  "details": { "database": { "status": "up" } }
}
```

**503 — banco indisponível**
```json
{
  "status": "error",
  "info":    {},
  "error":   { "database": { "status": "down", "message": "..." } },
  "details": { "database": { "status": "down", "message": "..." } }
}
```

---

## 5. Interação com métricas (informativo)

`GET /health` continua contabilizado em `http_requests_total{route="/health"}`, incluindo respostas
`503` — intencional, pois um health check falhando deve aparecer na taxa de erro 5xx. Não adicionar
exceção para `/health` no `HttpMetricsMiddleware`.

---

## 6. Critérios de aceite

- [ ] **CA1** — `@nestjs/terminus` consta em `dependencies` no `package.json` do `products-service`.
- [ ] **CA2** — Com serviço e Postgres no ar, `curl -i http://localhost:3001/health` retorna **200**
  com `"status":"ok"` e `"database":{"status":"up"}` em `info` e `details`.
- [ ] **CA3** — `GET /health` sem `Authorization` retorna 200 (não 401).
- [ ] **CA4** — Com o Postgres da porta 5436 parado, `GET /health` retorna **503** com
  `"status":"error"` e `error.database.status == "down"`.
- [ ] **CA5** — Ao religar o Postgres, `GET /health` volta a **200** sem reiniciar o serviço.
- [ ] **CA6** — Não existe mais handler `GET /health` em `app.controller.ts`; `GET /` continua
  respondendo `Hello World!`.
- [ ] **CA7** — Com o Postgres fora, `GET /health` responde em menos de **3s**.
- [ ] **CA8** — `npm run build`, `npm run lint` e `npm test` continuam verdes.
- [ ] **CA9** — Nenhum arquivo em `src/metrics/` ou `src/products/` foi alterado por esta entrega.

---

## 7. Validação manual

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/health   # 200
curl -s http://localhost:3001/health | jq

docker ps --filter "publish=5436"
docker stop <container-do-postgres-products>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/health   # 503

docker start <container-do-postgres-products>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/health   # 200
```

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Esquecer `@Public()` → 401 no `/health` | CA3 cobre a chamada sem token |
| Dois handlers para `GET /health` | RF3 + CA6 |
| `/health` pendurado com Postgres inacessível | `timeout: 1500` (CA7) |
| Health check pesado no banco | `pingCheck` executa `SELECT 1` no pool existente; não abre conexão nova |

---

## 9. Dependências e sequência

- **Depende de:** spec [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md) (mecanismo `@Public()`).
- **Relacionada:** `api-gateway/docs/specs/02 - health-check-avancado-com-terminus.md`.
- **Consumida por:** `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`.
