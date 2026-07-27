# SPEC: Health check avançado com `@nestjs/terminus` (PostgreSQL)

> **Status:** Proposta
> **Serviço:** `users-service` (porta `3000`)
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
| Implementação | `AppService.getHealth()` retorna literal `{ status: 'ok', service: 'users-service' }` |
| Verificação de dependências | **Nenhuma** — responde `200` mesmo com o Postgres fora do ar |
| Banco | TypeORM/Postgres, `TypeOrmModule.forRoot(databaseConfig)` em `AppModule`; `localhost:5433`, database `users_db` |
| Guard global | `JwtAuthGuard` via `APP_GUARD` em `AppModule` — rotas exigem JWT por padrão, liberadas com `@Public()` (`src/auth/decorators/public.decorator.ts`) |
| Métricas | `HttpMetricsMiddleware` aplicado a `*`; conta toda requisição em `http_requests_total`, exceto `/metrics` |

**Consumidor externo do endpoint:** o `api-gateway` chama `GET http://localhost:3000/health`
(`api-gateway/src/common/health/health-check.service.ts`) e avalia **apenas o status HTTP** — não lê
o corpo. Portanto, a mudança de formato de resposta descrita nesta spec **não quebra o gateway**,
mas passa a marcá-lo como `unhealthy` quando o banco cair — que é exatamente o comportamento
desejado.

---

## 2. Dependência

Instalar como dependência de produção (`dependencies`):

```bash
npm install @nestjs/terminus
```

- Versão: `^11.0.0` (linha compatível com `@nestjs/core` 11.x já instalado — 11.1.27).
- `@nestjs/typeorm`, `typeorm` e `pg` **já estão instalados**; nenhuma outra dependência é necessária.
- **Não** instalar `@nestjs/axios` aqui — este serviço não faz health check HTTP de terceiros.

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
- Deve importar `TerminusModule` do `@nestjs/terminus`.
- Deve declarar `HealthController` em `controllers`.
- Não precisa importar `TypeOrmModule` — a conexão default já é global (registrada por
  `TypeOrmModule.forRoot` no `AppModule`); o `TypeOrmHealthIndicator` resolve o `DataSource` default.
- Deve ser importado no array `imports` do `AppModule` (`src/app.module.ts`). Nenhum outro
  comportamento do `AppModule` pode ser alterado.

### RF2 — `HealthController`
- Rota: `@Controller('health')` + `@Get()` → responde em `GET /health`.
- Deve ser decorado com `@Public()` (`src/auth/decorators/public.decorator.ts`), para que o
  `JwtAuthGuard` global não exija token. **Sem isso o endpoint passa a devolver 401** e o gateway
  passa a ver o serviço como `unhealthy`.
- Deve usar o decorator `@HealthCheck()` do Terminus no handler.
- Deve executar, via `HealthCheckService.check([...])`, um único indicador:

```ts
// forma esperada da implementação
@Public()
@Get()
@HealthCheck()
check() {
  return this.health.check([
    () => this.db.pingCheck('database', { timeout: 1500 }),
  ]);
}
```

- `timeout: 1500` (ms) é obrigatório: sem timeout explícito, um Postgres que aceita a conexão TCP
  mas não responde deixa o `/health` pendurado, e o gateway (timeout de 10s) fica bloqueado.
- A chave do indicador deve ser exatamente **`database`** — os critérios de aceite e a spec do
  `api-gateway` dependem desse nome.

### RF3 — Remoção do health antigo
- Remover o handler `getHealth()` de `src/app.controller.ts` e o método `getHealth()` de
  `src/app.service.ts`. Não podem coexistir dois handlers para `GET /health` — o Nest resolveria
  para o primeiro registrado e a verificação real seria silenciosamente ignorada.
- O handler `GET /` (`getHello`) permanece inalterado.

### RF4 — Contrato de resposta
Formato padrão do Terminus (não inventar um envelope próprio):

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

> **Mudança de contrato consciente:** o corpo deixa de ter o campo `service`. Nenhum consumidor no
> repositório lê esse campo (o gateway só olha o status HTTP), então a remoção é segura.

---

## 5. Interação com métricas (informativo, não exige mudança)

`GET /health` continua sendo contabilizado em `http_requests_total{route="/health"}` pelo
`HttpMetricsMiddleware` — inclusive as respostas `503`. Isso é **intencional**: um `/health`
falhando é um sintoma real e deve aparecer na taxa de erro 5xx. Não adicionar exceção para
`/health` no middleware (a spec 07 só isenta `/metrics`).

---

## 6. Critérios de aceite

- [ ] **CA1** — `@nestjs/terminus` consta em `dependencies` no `package.json` do `users-service`.
- [ ] **CA2** — Com o serviço e o Postgres no ar, `curl -i http://localhost:3000/health` retorna
  **200** e o corpo contém `"status":"ok"` e `"database":{"status":"up"}` em `info` e `details`.
- [ ] **CA3** — `GET /health` **sem** header `Authorization` retorna 200 (não 401), mesmo com o
  `JwtAuthGuard` global ativo.
- [ ] **CA4** — Com o container do Postgres parado (`docker stop <pg-users>`),
  `curl -i http://localhost:3000/health` retorna **503**, com `"status":"error"` e
  `error.database.status == "down"`.
- [ ] **CA5** — Ao subir o Postgres novamente, o mesmo `curl` volta a **200** sem reiniciar o
  serviço (o indicador reflete o estado atual, não o do boot).
- [ ] **CA6** — Não existe mais nenhum handler `GET /health` em `app.controller.ts`; `GET /` continua
  respondendo `Hello World!`.
- [ ] **CA7** — Com o Postgres fora, `GET /health` responde em **menos de 3s** (efeito do
  `timeout: 1500`), não ficando pendurado.
- [ ] **CA8** — `npm run build`, `npm run lint` e a suíte de testes existente (`npm test`) continuam
  verdes.
- [ ] **CA9** — Nenhum arquivo em `src/metrics/` foi alterado por esta entrega.

---

## 7. Validação manual

```bash
# 1. serviço + banco no ar
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/health   # 200
curl -s http://localhost:3000/health | jq

# 2. derrubar o banco do users-service (porta 5433)
docker ps --filter "publish=5433"
docker stop <container-do-postgres-users>

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/health   # 503
curl -s http://localhost:3000/health | jq '.error'

# 3. subir de volta
docker start <container-do-postgres-users>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/health   # 200
```

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Esquecer `@Public()` → `/health` retorna 401 e o gateway marca o serviço como `unhealthy` | CA3 cobre explicitamente a chamada sem token |
| Dois handlers para `GET /health` (antigo + novo) | RF3 exige remoção do antigo; CA6 verifica |
| `/health` pendurado quando o Postgres aceita TCP mas não responde | `timeout: 1500` no `pingCheck` (CA7) |
| `pingCheck` abrir conexão nova a cada chamada | O indicador usa o `DataSource` já existente (pool do TypeORM); não abre conexão avulsa |

---

## 9. Dependências e sequência

- **Depende de:** spec [`04 - route-protection-jwt-guard`](./04%20-%20route-protection-jwt-guard.md)
  (mecanismo `@Public()`).
- **Relacionada:** `api-gateway/docs/specs/02 - health-check-avancado-com-terminus.md` — o gateway
  passa a agregar este `/health`.
- **Consumida por:** `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`.
