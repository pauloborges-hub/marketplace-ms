# SPEC: Instrumentação de métricas HTTP com `prom-client` (`GET /metrics`)

> **Objetivo:** Expor, em `GET /metrics`, métricas HTTP no formato de exposição do Prometheus
> (`http_requests_total`, `http_request_duration_seconds`) mais as métricas padrão do Node.js,
> para que o `api-gateway` deixe de aparecer como target `DOWN` no Prometheus provisionado pela
> SPEC 19 (`criar-observability-stack-prometheus-grafana`).
>
> **Escopo desta spec:** dependência `prom-client`, módulo `MetricsModule` global com
> `MetricsService`, `HttpMetricsInterceptor` e `MetricsController`, registro no `AppModule`, e
> garantia de que `GET /metrics` fica acessível sem JWT e sem ser afetado pelo rate limiting
> global do gateway.
> **Fora de escopo:** métricas de negócio customizadas (ex.: requisições proxied por serviço
> downstream, taxa de acionamento do circuit breaker/fallback) — virão em spec futura; dashboards
> no Grafana; qualquer alteração em `observability-stack/` (Prometheus/Grafana já estão
> configurados pela SPEC 19 e não devem ser tocados aqui); qualquer alteração no comportamento de
> proxy, circuit breaker, retry, timeout ou fallback já existentes.

---

## 1. Contexto: o `api-gateway` tem um padrão de guards diferente

A SPEC 19 (`../../docs/specs/criar-observability-stack-prometheus-grafana.md`, na raiz do
projeto) subiu Prometheus (`:9090`) e Grafana (`:3010`) via `observability-stack/`, com o
Prometheus já configurado para fazer scrape de `GET http://host.docker.internal:3005/metrics` a
cada 15s (job `api-gateway`). Como nenhum serviço expõe `/metrics` hoje, esse target aparece como
`DOWN` — comportamento esperado e aceito naquela spec.

Diferente do `users-service`, `products-service` e `checkout-service` — onde um `JwtAuthGuard`
global (via `APP_GUARD`) protege toda rota por padrão, exigindo o decorator `@Public()` para
liberar exceções — o `api-gateway` (`src/app.module.ts`) funciona de forma **oposta**:

- **Não há guard de JWT global.** O único `APP_GUARD` registrado é o `CustomThrottlerGuard`
  (`src/guards/throttler.guard.ts`), de rate limiting.
- O `JwtAuthGuard` (`src/guards/auth.guard.ts`) só é aplicado **rota a rota**, explicitamente,
  via `@UseGuards(JwtAuthGuard)` nos controllers que fazem proxy para endpoints protegidos (ex.:
  `GET /users/profile`, `GET /users/:id` em `src/users/users.controller.ts`).
- Existe um decorator `@Public()` (`src/auth/decorators/public.decorator.ts`), mas ele **não é
  usado em lugar nenhum hoje** — porque, nesse serviço, uma rota já nasce pública por padrão
  (basta não colocar `@UseGuards(JwtAuthGuard)` nela). Não há necessidade de usá-lo nesta spec.
- O `CustomThrottlerGuard`, esse sim, é global e afeta **toda** rota, incluindo o futuro
  `GET /metrics` — com três buckets configurados (`short`: 10 req/s, `medium`: 100 req/min,
  `long`: 1000 req/15min). O scrape do Prometheus (1 requisição a cada 15s) fica bem abaixo
  desses limites, mas ainda assim é desejável isentar `/metrics` do rate limiting, já que é
  tráfego de infraestrutura/observabilidade, não tráfego de cliente (ver RF5).
- Não há nenhum endpoint em `/metrics` hoje, nem controller "coringa" (`@All('*')`) que poderia
  capturar essa rota antes do novo `MetricsController` — não há conflito de rota a resolver aqui
  (diferente do `payments-service`, que precisou renomear um endpoint existente).

Esta spec instrumenta o gateway para expor métricas HTTP genéricas (não de negócio) via
`prom-client`, seguindo o padrão do serviço: simplesmente **não aplicar** `@UseGuards(JwtAuthGuard)`
na nova rota, e isentá-la do throttling.

---

## 2. Stack e padrões

- **Biblioteca de métricas:** [`prom-client`](https://github.com/siimon/prom-client), versão
  estável mais recente da major 15 (ex.: `^15.1.0`).
- **Registry isolado:** a instância de `Registry` do `prom-client` deve ser criada **localmente**
  dentro do `MetricsService` (`new Registry()`), e **não** deve usar o registry global padrão do
  módulo (`prom-client`'s `register`). Isso evita o erro `"A metric with the name ... has already
  been registered"` caso o módulo Nest seja instanciado mais de uma vez no mesmo processo (ex.:
  múltiplos testes e2e no mesmo arquivo de teste rodando em série).
- **Interceptor global:** registrado via token `APP_INTERCEPTOR` do NestJS, dentro do próprio
  `MetricsModule` — não precisa ser registrado manualmente no `AppModule`.
- **Rota pública por padrão:** a rota `GET /metrics` não deve ter `@UseGuards(JwtAuthGuard)` —
  isso já é suficiente para deixá-la acessível sem token, dado o padrão do gateway (ver seção 1).
  Não é necessário (nem incorreto) decorar com `@Public()`, já que esse decorator não tem efeito
  sem um guard global que o leia.
- **Isenção de rate limiting:** a rota deve usar `@SkipThrottle()` (de `@nestjs/throttler`, já
  instalado) para não ser contabilizada pelo `CustomThrottlerGuard` global.
- O projeto deve continuar **enxuto**: nenhuma métrica de negócio, nenhum endpoint além de
  `GET /metrics`, nenhuma dependência além de `prom-client`.

---

## 3. Estrutura de arquivos

Criar, dentro de `src/`:

```
src/metrics/
├── metrics.module.ts
├── metrics.service.ts
├── metrics.controller.ts
└── interceptors/
    └── http-metrics.interceptor.ts
```

---

## 4. Requisitos funcionais

### RF1 — Dependência
- Instalar `prom-client` como dependência de produção (`dependencies`, não `devDependencies`) do
  `api-gateway`.

### RF2 — `MetricsService`
- Deve manter uma instância própria de `Registry` do `prom-client` (não o registry global do
  módulo), acessível apenas internamente.
- Deve chamar `collectDefaultMetrics({ register })` sobre esse registry, uma única vez, na
  construção do serviço, habilitando as métricas padrão do processo Node.js (CPU, memória,
  event loop, garbage collector, etc.).
- Deve expor um `Counter` chamado `http_requests_total`, com labels `method`, `route` e
  `status_code`, incrementado a cada requisição HTTP concluída (sucesso ou erro).
- Deve expor um `Histogram` chamado `http_request_duration_seconds`, com as mesmas labels
  (`method`, `route`, `status_code`), registrando a duração da requisição em segundos.
- Deve expor um método para obter a string de métricas no formato de exposição do Prometheus
  (`registry.metrics()`) e o `Content-Type` correto para a resposta (`registry.contentType`).
- Não deve expor nenhuma métrica de negócio (nada de contagem de requisições por serviço
  downstream, acionamentos de circuit breaker/fallback, etc.).

### RF3 — `HttpMetricsInterceptor`
- Deve ser um `NestInterceptor` registrado globalmente via `APP_INTERCEPTOR`, aplicado a toda
  requisição HTTP do gateway — incluindo as rotas que fazem proxy para os serviços downstream
  (ex.: `/users/*`, `/products/*`, `/payments/*`).
- Para cada requisição, deve capturar:
  - `method`: o verbo HTTP (`GET`, `POST`, etc.).
  - `route`: o **padrão** da rota tal como definida nos controllers do gateway (ex.:
    `/users/:id`, `/auth/login`), nunca a URL resolvida com valores reais e nunca a rota do
    serviço downstream para o qual a requisição foi proxied (o label reflete a rota do gateway
    em si, não do serviço de destino). Se o Nest não conseguir resolver uma rota (ex.: 404 em
    caminho inexistente), a label `route` deve usar um valor fixo (ex.: `unmatched`) — nunca o
    caminho bruto da URL — para não gerar cardinalidade ilimitada de séries no Prometheus.
  - `status_code`: o código HTTP final da resposta enviada ao cliente pelo gateway (incluindo
    respostas de erro tratadas por exception filters ou repassadas de um serviço downstream),
    capturado de forma confiável — recomenda-se usar o evento `finish` da resposta HTTP
    (`res.on('finish', ...)`) para garantir que o valor não seja provisório.
  - `duration`: o tempo decorrido entre o início e o fim da requisição no gateway, em segundos
    (inclui o tempo gasto no proxy para o serviço downstream, quando aplicável).
- Deve incrementar `http_requests_total` e observar `http_request_duration_seconds` com essas
  labels, para toda requisição — incluindo as que resultam em erro (4xx/5xx) e as que são
  bloqueadas pelo `CustomThrottlerGuard` (429).
- **Exceção:** requisições para `GET /metrics` não devem gerar nenhum incremento de métrica (nem
  no counter, nem no histogram), evitando que o próprio endpoint de métricas infle suas contagens
  a cada scrape do Prometheus.

### RF4 — `MetricsController`
- Deve expor `GET /metrics`, retornando o corpo gerado por `MetricsService` (formato de exposição
  do Prometheus) com o `Content-Type` correto (`registry.contentType`, tipicamente
  `text/plain; version=0.0.4; charset=utf-8`).
- Não deve ter `@UseGuards(JwtAuthGuard)` — permanece pública por ausência de guard, seguindo o
  padrão do gateway descrito na seção 1.
- Deve ser decorada com `@SkipThrottle()` para não ser afetada pelo `CustomThrottlerGuard`
  global.
- Não deve exigir nenhum parâmetro, header ou body.

### RF5 — `MetricsModule`
- Deve ser um módulo `@Global()`, contendo `MetricsController` e provendo `MetricsService`.
- Deve registrar `HttpMetricsInterceptor` como `APP_INTERCEPTOR` em seus `providers` (não no
  `AppModule`), para manter toda a instrumentação encapsulada no módulo.
- Deve ser importado uma única vez em `AppModule` (`src/app.module.ts`).

### RF6 — Registro no `AppModule`
- `MetricsModule` deve ser adicionado ao array `imports` de `AppModule`.
- Nenhum outro comportamento do `AppModule` (`CustomThrottlerGuard`, `ProxyModule`,
  `MiddlewareModule`, demais módulos) deve ser alterado por esta spec.
- O `LoggingMiddleware`, aplicado a `'*'` via `configure()`, continuará também interceptando
  `GET /metrics` — isso é aceitável e não precisa ser alterado por esta spec.

---

## 5. Tabela de métricas expostas

| Métrica | Tipo | Labels | Descrição |
| --- | --- | --- | --- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total de requisições HTTP recebidas pelo gateway. |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições HTTP no gateway, em segundos. |
| `process_cpu_user_seconds_total` | Counter | — | Métrica padrão do Node.js (via `collectDefaultMetrics`). |
| `process_resident_memory_bytes` | Gauge | — | Métrica padrão do Node.js. |
| `nodejs_heap_size_total_bytes` | Gauge | — | Métrica padrão do Node.js. |
| `nodejs_eventloop_lag_seconds` | Gauge | — | Métrica padrão do Node.js. |
| *(demais métricas padrão de `collectDefaultMetrics`)* | — | — | Conjunto completo de métricas padrão do `prom-client` para o runtime Node.js. |

---

## 6. Critérios de aceite

- [ ] **CA1** — `prom-client` consta em `dependencies` no `package.json` do `api-gateway`.
- [ ] **CA2** — Com o serviço rodando (`npm run start:dev`), `curl -i http://localhost:3005/metrics`
  retorna **200** com header `Content-Type: text/plain; version=0.0.4; charset=utf-8` (ou
  equivalente gerado pelo `prom-client`).
- [ ] **CA3** — O corpo da resposta contém `# TYPE http_requests_total counter` e ao menos uma
  série com labels `method`, `route` e `status_code`.
- [ ] **CA4** — O corpo da resposta contém `# TYPE http_request_duration_seconds histogram`, com
  linhas `_bucket`, `_sum` e `_count`.
- [ ] **CA5** — O corpo da resposta contém métricas padrão do Node.js, por exemplo
  `process_cpu_user_seconds_total` e `nodejs_heap_size_total_bytes`.
- [ ] **CA6** — `GET /metrics` sem header `Authorization` retorna 200 (não 401).
- [ ] **CA7** — Fazer mais de 10 requisições consecutivas a `GET /metrics` em menos de 1 segundo
  não retorna 429 (Too Many Requests) — confirma que `@SkipThrottle()` está funcionando.
- [ ] **CA8** — Fazer requisições a `GET /users/<id1>` e `GET /users/<id2>` (dois IDs válidos
  diferentes, com token válido) resulta em uma única série `http_requests_total` com
  `route="/users/:id"` — os valores de `id` não aparecem na label `route`.
- [ ] **CA9** — Fazer múltiplas requisições consecutivas a `GET /metrics` e confirmar, no corpo
  retornado, que não existe nenhuma série de `http_requests_total` (nem `http_request_duration_seconds`)
  com `route="/metrics"`.
- [ ] **CA10** — Uma requisição a uma rota inexistente (ex.: `GET /rota-que-nao-existe`) retorna
  404 e é contabilizada em `http_requests_total` com `status_code="404"`.
- [ ] **CA11** — Uma requisição a `GET /users/profile` sem token retorna 401 (comportamento
  inalterado do `JwtAuthGuard` aplicado por rota) e é contabilizada em `http_requests_total` com
  `status_code="401"`.
- [ ] **CA12** — Com o `api-gateway` rodando na porta 3005 e a stack da SPEC 19
  (`observability-stack/`) no ar, após aguardar ao menos um ciclo de scrape (15s), o target
  `api-gateway` em `http://localhost:9090/targets` aparece como **UP**.
- [ ] **CA13** — As rotas de proxy existentes (`POST /auth/register`, `POST /auth/login`,
  `GET /users/profile`, etc.) continuam funcionando exatamente como antes; nenhum comportamento
  de proxy, circuit breaker, retry, timeout ou fallback foi alterado por esta spec.

---

## 7. Dependências e sequência

Depende de:
- SPEC 19 (`../../docs/specs/criar-observability-stack-prometheus-grafana.md`) — Prometheus já
  configurado para fazer scrape de `:3005/metrics`.

Não depende de nenhuma spec anterior específica do `api-gateway` (não há `docs/specs/` prévio
neste serviço) — esta é a primeira spec documentada em `api-gateway/docs/specs/`.

Specs futuras (fora de escopo aqui): métricas de negócio customizadas (ex.: contagem de
requisições por serviço downstream, acionamentos de circuit breaker), dashboards no Grafana.
