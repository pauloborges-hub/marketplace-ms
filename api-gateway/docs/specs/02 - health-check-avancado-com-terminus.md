# SPEC: Health check avançado com `@nestjs/terminus` (4 serviços downstream via HTTP)

> **Status:** Proposta
> **Serviço:** `api-gateway` (porta `3005`)
> **Objetivo:** Reimplementar o `GET /health` sobre `@nestjs/terminus`, agregando o estado dos
> **4 serviços downstream** (`users`, `products`, `checkout`, `payments`) via `HttpHealthIndicator`
> (`@nestjs/axios`), e devolvendo **503** quando algum deles estiver indisponível.
>
> **Fora de escopo:** readiness/liveness probes — `GET /health/ready` e `GET /health/live` **já
> existem** e permanecem **exatamente como estão**, nenhum novo probe deve ser criado; notificações
> externas; alteração de métricas existentes; alteração do `CircuitBreakerService`, `RetryService`,
> `TimeoutService` ou `ProxyService`; regras de alerta no Prometheus
> (ver `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`).

---

## 1. Contexto atual (fatos verificados no código)

O gateway **não tem banco próprio** — sua saúde é, essencialmente, a saúde de quem ele encapsula.

| Rota | Arquivo | O que faz hoje |
|---|---|---|
| `GET /health` | `src/health/health.controller.ts` | Retorna literal `{ status: 'ok', timestamp, uptime, memory, version }` — **não verifica nada** |
| `GET /health/services` | idem | Chama `HealthCheckService.checkAllServices()` (verificação real dos 4 downstream) e agrega em `healthy`/`degraded`/`unhealthy` — **sempre 200**, mesmo com tudo fora |
| `GET /health/services/:serviceName` | idem | Lê o cache em memória (`healthCache`), sem checar nada |
| `GET /health/ready` | idem | `HealthService.getReadyStatus()` — **fora de escopo, não alterar** |
| `GET /health/live` | idem | `HealthService.getLiveStatus()` — **fora de escopo, não alterar** |

| Item | Situação hoje |
|---|---|
| Downstream | `src/config/gateway.config.ts` → `serviceConfig` com `users:3000`, `products:3001`, `checkout:3003`, `payments:3004` (env `*_SERVICE_URL`), `timeout: 10000` cada |
| Cliente HTTP | `@nestjs/axios` **já instalado**; `HttpModule` importado no `HealthCheckModule` |
| Verificação existente | `HealthCheckService` chama `GET {url}/health` de cada serviço, envolto em `CircuitBreakerService` (`failureThreshold: 5`, `resetTimeout: 30000`), com `Promise.allSettled` |
| Guard global | `CustomThrottlerGuard` via `APP_GUARD` — **rate limit `short` de 10 req/s por (IP + user-agent)** |
| Métricas | `HttpMetricsMiddleware` aplicado a `*`, conta tudo exceto `/metrics` |

### 1.1 O problema

`GET /health` mente: responde `200` mesmo com os 4 serviços fora. A verificação real existe, mas mora
em `/health/services`, **que também sempre devolve 200** — inútil para qualquer monitor que decida
por status HTTP. Esta spec faz `/health` passar a refletir a realidade e a devolver `503`.

---

## 2. Dependência

```bash
npm install @nestjs/terminus
```

- Versão `^11.0.0` (compatível com `@nestjs/core` 11.x já instalado).
- `@nestjs/axios` e `axios` **já estão instalados** — o `HttpHealthIndicator` os usa por baixo.
- **Não** instalar `@nestjs/typeorm`, `pg`, `@nestjs/microservices` nem `amqp-connection-manager`:
  o gateway não tem banco nem fala com o broker.

---

## 3. Pré-requisito de sequenciamento

Este health check depende do `GET /health` **de cada downstream** já refletir suas próprias
dependências. Implementar antes das specs abaixo faz o gateway reportar `up` para serviços com o
banco fora:

- `users-service/docs/specs/08 - health-check-avancado-com-terminus.md`
- `products-service/docs/specs/07 - health-check-avancado-com-terminus.md`
- `checkout-service/docs/specs/05 - health-check-avancado-com-terminus.md`
- `payments-service/docs/specs/03 - health-check-avancado-com-terminus.md`

⚠️ **Efeito colateral esperado e desejado:** com aquelas specs no ar, `GET {downstream}/health`
passa a responder **503** quando o Postgres/RabbitMQ do downstream cai. O `HttpHealthIndicator`
(assim como o `HealthCheckService` atual) trata não-2xx como falha — logo, um banco do
`payments-service` fora derruba o `/health` do gateway para 503. Isso é **correto**: significa "a
plataforma não está inteira". Alertas com granularidade por serviço ficam a cargo do Prometheus
(regra `ServiceDown` na spec de alerting), que observa cada `job` individualmente.

---

## 4. Estrutura de arquivos

```
src/health/
├── health.module.ts        # ALTERADO — passa a importar TerminusModule e HttpModule
├── health.controller.ts    # ALTERADO — GET /health reimplementado com Terminus
└── health.service.ts       # INALTERADO (serve /health/ready e /health/live)
```

Nenhum arquivo novo é necessário. `src/common/health/*` (`HealthCheckService`,
`HealthCheckModule`, `health-check.interface.ts`) permanece **inalterado**.

---

## 5. Requisitos funcionais

### RF1 — `HealthModule`
- Passa a importar `TerminusModule` e `HttpModule` (de `@nestjs/axios`), mantendo o import atual de
  `HealthCheckModule` (necessário para `/health/services` e `/health/services/:name`, que não mudam).
- `HealthService` continua em `providers` — `/health/ready` e `/health/live` dependem dele.
- Nenhuma alteração no `AppModule`: `HealthModule` já está no array `imports`.

### RF2 — `GET /health` reimplementado
- Substituir o corpo do handler `getHealth()` em `src/health/health.controller.ts` por uma checagem
  Terminus com **quatro** indicadores HTTP, um por downstream:

```ts
@Get()
@SkipThrottle()
@HealthCheck()
check() {
  return this.health.check([
    () => this.http.pingCheck('users-service',    `${serviceConfig.users.url}/health`,    { timeout: 3000 }),
    () => this.http.pingCheck('products-service', `${serviceConfig.products.url}/health`, { timeout: 3000 }),
    () => this.http.pingCheck('checkout-service', `${serviceConfig.checkout.url}/health`, { timeout: 3000 }),
    () => this.http.pingCheck('payments-service', `${serviceConfig.payments.url}/health`, { timeout: 3000 }),
  ]);
}
```

- **Chaves obrigatórias e exatas:** `users-service`, `products-service`, `checkout-service`,
  `payments-service` — iguais aos `job_name` do Prometheus (`observability-stack/prometheus/prometheus.yml`),
  para que a leitura do `/health` e a do dashboard usem o mesmo vocabulário.
- **URLs obrigatoriamente vindas de `serviceConfig`** (`src/config/gateway.config.ts`) — nunca
  hard-coded. Assim `USERS_SERVICE_URL` & cia. continuam valendo e existe uma única fonte de verdade
  de endereço de downstream.
- **`timeout: 3000` (ms) obrigatório**, deliberadamente **menor** que o `timeout: 10000` de
  `serviceConfig` usado nas chamadas de proxy: um health check tem que responder rápido. Com os 4
  indicadores rodando em paralelo (comportamento padrão do `HealthCheckService` do Terminus), o pior
  caso do `/health` fica em ~3s, não em 40s.

### RF3 — `@SkipThrottle()` obrigatório
- O handler deve ser decorado com `@SkipThrottle()` (`@nestjs/throttler`).
- **Motivo:** o `CustomThrottlerGuard` global aplica `short: 10 req/s` por `IP + user-agent`. Um
  monitor externo com poll agressivo — ou vários checks simultâneos vindos do mesmo IP — passa a
  receber **429**, que um monitor interpreta como "gateway doente". Um health check jamais deve ser
  limitado por rate limit.
- `CustomThrottlerGuard` sobrescreve apenas `getTracker` e `handleRequest`; `canActivate` (onde o
  Terminus/Throttler avalia o metadata de skip) continua o da classe base, então `@SkipThrottle()`
  funciona sem alteração no guard. **Se na prática não funcionar, o guard não deve ser alterado
  nesta spec** — registrar como known issue e abrir spec própria.

### RF4 — Rotas preservadas
- `GET /health/services`, `GET /health/services/:serviceName`, `GET /health/ready` e
  `GET /health/live` permanecem **byte a byte como estão**: mesmo caminho, mesmo corpo, mesmo status.
- `HealthCheckService` (`src/common/health/`) — com todo o wrapper de circuit breaker e o
  `healthCache` — **não é tocado**. Ele continua servindo `/health/services`, que oferece detalhe
  (tempo de resposta, `lastCheck`, estado `degraded`) que o `/health` do Terminus não dá.
- **Coexistência consciente:** passam a existir dois mecanismos de verificação de downstream. É
  aceito nesta entrega — `/health` é o veredito binário (200/503) para monitores, `/health/services`
  é a visão detalhada para humanos. Unificar os dois é candidato a spec futura.

### RF5 — Contrato de resposta do `GET /health`

**200 — os 4 downstream respondendo**
```json
{
  "status": "ok",
  "info": {
    "users-service":    { "status": "up" },
    "products-service": { "status": "up" },
    "checkout-service": { "status": "up" },
    "payments-service": { "status": "up" }
  },
  "error": {},
  "details": { "...": "espelha info + error" }
}
```

**503 — algum downstream fora**
```json
{
  "status": "error",
  "info":  { "users-service": { "status": "up" }, "products-service": { "status": "up" }, "checkout-service": { "status": "up" } },
  "error": { "payments-service": { "status": "down", "message": "..." } },
  "details": { "...": "espelha info + error" }
}
```

> **Mudança de contrato consciente:** somem `uptime`, `memory` e `version` do corpo de `/health`.
> Nenhum consumidor no repositório lê esses campos, e todos eles seguem disponíveis via
> `/health/ready`, `/health/live` e — com muito mais fidelidade — nas métricas do Prometheus
> (`process_resident_memory_bytes`, `process_start_time_seconds`).

---

## 6. Interação com métricas (informativo, não exige mudança)

`GET /health` continua contabilizado em `http_requests_total{route="/health"}`, incluindo os `503` —
intencional. Não adicionar exceção para `/health` no `HttpMetricsMiddleware`.

⚠️ **Atenção operacional:** cada chamada a `/health` do gateway dispara **4 requisições HTTP** aos
downstream, que por sua vez são contabilizadas nas métricas **deles** (`route="/health"`). Poll muito
frequente infla o throughput dos 4 serviços com tráfego sintético. Para poll externo, usar intervalo
≥ 15s.

---

## 7. Critérios de aceite

### Dependências e fiação
- [ ] **CA1** — `@nestjs/terminus` consta em `dependencies` no `package.json` do `api-gateway`.
- [ ] **CA2** — As URLs dos indicadores vêm de `serviceConfig`; nenhuma URL de downstream aparece
  hard-coded em `health.controller.ts`.

### Caminho feliz
- [ ] **CA3** — Com os 4 serviços no ar, `curl -i http://localhost:3005/health` retorna **200** com
  `"status":"ok"` e as 4 chaves (`users-service`, `products-service`, `checkout-service`,
  `payments-service`) em `"status":"up"`.
- [ ] **CA4** — 20 chamadas consecutivas a `GET /health` (acima do limite `short` de 10 req/s) **não**
  retornam nenhum **429** — efeito do `@SkipThrottle()`.

### Falhas de downstream
- [ ] **CA5** — Parando o `payments-service`, `GET /health` retorna **503**, com `payments-service`
  em `error` e os outros três em `info` como `up`.
- [ ] **CA6** — Parando **todos** os 4 serviços, `GET /health` retorna **503** com as 4 chaves em
  `error`.
- [ ] **CA7** — Com os 4 serviços de pé mas o **Postgres do `payments-service` parado** (o downstream
  responde 503 no seu próprio `/health`), o `GET /health` do gateway retorna **503** com
  `payments-service` em `error` — a falha se propaga corretamente.
- [ ] **CA8** — Religando o que foi derrubado, `GET /health` volta a **200** sem reiniciar o gateway.
- [ ] **CA9** — Com um downstream **parado** (conexão recusada), `GET /health` responde em menos de
  **5s** — os 4 checks rodam em paralelo com `timeout: 3000`, não em série com os 10s de
  `serviceConfig`.

### Regressão
- [ ] **CA10** — `GET /health/services` continua retornando **200** com o mesmo formato de antes
  (`overallStatus`, `services[]`, `summary`), inclusive quando há serviço fora.
- [ ] **CA11** — `GET /health/services/:serviceName`, `GET /health/ready` e `GET /health/live`
  continuam com caminho, corpo e status **inalterados**.
- [ ] **CA12** — Nenhum arquivo em `src/common/health/`, `src/common/circuit-breaker/`,
  `src/proxy/` ou `src/metrics/` foi alterado.
- [ ] **CA13** — Nenhum novo endpoint de readiness/liveness foi criado.
- [ ] **CA14** — `npm run build`, `npm run lint` e `npm test` continuam verdes.

---

## 8. Validação manual

```bash
# 1. com os 5 serviços no ar
curl -s http://localhost:3005/health | jq          # status ok, 4 chaves up

# 2. rate limit não se aplica ao /health
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code} ' http://localhost:3005/health
done; echo    # 20x 200, nenhum 429

# 3. derrubar um downstream (Ctrl+C no processo do payments-service)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3005/health   # 503
curl -s http://localhost:3005/health | jq '.error'                      # payments-service down

# 4. a visão detalhada continua funcionando e retornando 200
curl -s http://localhost:3005/health/services | jq '.overallStatus, .summary'

# 5. subir o payments-service de volta
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3005/health   # 200
```

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| `429` do throttler interpretado por monitores como serviço doente | `@SkipThrottle()` obrigatório (RF3, CA4) |
| `/health` lento por herdar o `timeout: 10000` do proxy | `timeout: 3000` explícito em cada indicador; execução paralela (CA9) |
| Gateway reportado como `down` por causa do banco de um downstream | Comportamento **intencional** (seção 3, CA7); granularidade por serviço vem da regra `ServiceDown` no Prometheus |
| Divergência entre `/health` (Terminus) e `/health/services` (circuit breaker) | Coexistência documentada em RF4; papéis distintos; unificação é spec futura |
| Poll agressivo do `/health` inflando o throughput dos 4 downstream | Documentado na seção 6; intervalo ≥ 15s recomendado |
| Quebrar `/health/ready` e `/health/live` "de passagem" | CA11 + CA13 |

---

## 10. Dependências e sequência

- **Depende de:** as 4 specs de health check dos downstream (seção 3) — implementar **depois** delas.
- **Relacionada:** spec [`01 - instrumentacao-metricas-http-prometheus`](./01%20-%20instrumentacao-metricas-http-prometheus.md).
- **Consumida por:** `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`.
- **Candidato a spec futura:** unificar `/health` e `/health/services` num único mecanismo, com
  circuit breaker por trás do indicador Terminus.
