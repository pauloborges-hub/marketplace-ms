# SPEC: Instrumentação de métricas HTTP com `prom-client` (`GET /metrics`)

> **Objetivo:** Expor, em `GET /metrics`, métricas HTTP no formato de exposição do Prometheus
> (`http_requests_total`, `http_request_duration_seconds`) mais as métricas padrão do Node.js,
> para que o `products-service` deixe de aparecer como target `DOWN` no Prometheus provisionado
> pela SPEC 19 (`criar-observability-stack-prometheus-grafana`).
>
> **Escopo desta spec:** dependência `prom-client`, módulo `MetricsModule` global com
> `MetricsService`, `HttpMetricsInterceptor` e `MetricsController`, registro no `AppModule`, e
> marcação de `GET /metrics` como rota pública.
> **Fora de escopo:** métricas de negócio customizadas (ex.: produtos criados, listagens por
> minuto) — virão em spec futura; dashboards no Grafana; qualquer alteração em
> `observability-stack/` (Prometheus/Grafana já estão configurados pela SPEC 19 e não devem ser
> tocados aqui).

---

## 1. Contexto

A SPEC 19 (`../../docs/specs/criar-observability-stack-prometheus-grafana.md`, na raiz do
projeto) subiu Prometheus (`:9090`) e Grafana (`:3010`) via `observability-stack/`, com o
Prometheus já configurado para fazer scrape de `GET http://host.docker.internal:3001/metrics` a
cada 15s (job `products-service`). Como nenhum serviço expõe `/metrics` hoje, esse target aparece
como `DOWN` — comportamento esperado e aceito naquela spec.

O `products-service` hoje (spec [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md)):

- Tem um `JwtAuthGuard` registrado **globalmente** via `APP_GUARD` em `AppModule`
  (`src/app.module.ts`), exigindo JWT válido em toda rota por padrão.
- Usa o decorator `@Public()` (`src/auth/decorators/public.decorator.ts`, chave de metadata
  `IS_PUBLIC_KEY`) para marcar rotas que não exigem token.
- Não possui nenhum endpoint em `/metrics` hoje — não há conflito de rota a resolver.

Esta spec instrumenta o serviço para expor métricas HTTP genéricas (não de negócio) via
`prom-client`, seguindo exatamente esse mesmo mecanismo de rota pública para liberar
`GET /metrics` do JWT.

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
- **Rota pública:** reaproveita o `@Public()` já existente (`src/auth/decorators/public.decorator.ts`);
  nenhum novo mecanismo de autorização é introduzido.
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
  `products-service`.

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
- Não deve expor nenhuma métrica de negócio (nada de contagem de produtos, listagens, etc.).

### RF3 — `HttpMetricsInterceptor`
- Deve ser um `NestInterceptor` registrado globalmente via `APP_INTERCEPTOR`, aplicado a toda
  requisição HTTP do serviço.
- Para cada requisição, deve capturar:
  - `method`: o verbo HTTP (`GET`, `POST`, etc.).
  - `route`: o **padrão** da rota (ex.: `/products/:id`), nunca a URL resolvida com valores reais.
    Se o Nest não conseguir resolver uma rota (ex.: 404 em caminho inexistente), a label `route`
    deve usar um valor fixo (ex.: `unmatched`) — nunca o caminho bruto da URL — para não gerar
    cardinalidade ilimitada de séries no Prometheus.
  - `status_code`: o código HTTP final da resposta (incluindo respostas de erro tratadas por
    exception filters), capturado de forma confiável — recomenda-se usar o evento `finish` da
    resposta HTTP (`res.on('finish', ...)`) para garantir que o valor não seja provisório.
  - `duration`: o tempo decorrido entre o início e o fim da requisição, em segundos.
- Deve incrementar `http_requests_total` e observar `http_request_duration_seconds` com essas
  labels, para toda requisição — incluindo as que resultam em erro (4xx/5xx).
- **Exceção:** requisições para `GET /metrics` não devem gerar nenhum incremento de métrica (nem
  no counter, nem no histogram), evitando que o próprio endpoint de métricas infle suas contagens
  a cada scrape do Prometheus.

### RF4 — `MetricsController`
- Deve expor `GET /metrics`, retornando o corpo gerado por `MetricsService` (formato de exposição
  do Prometheus) com o `Content-Type` correto (`registry.contentType`, tipicamente
  `text/plain; version=0.0.4; charset=utf-8`).
- Deve ser marcado com `@Public()`, para que o `JwtAuthGuard` global não exija token nessa rota.
- Não deve exigir nenhum parâmetro, header ou body.

### RF5 — `MetricsModule`
- Deve ser um módulo `@Global()`, contendo `MetricsController` e provendo `MetricsService`.
- Deve registrar `HttpMetricsInterceptor` como `APP_INTERCEPTOR` em seus `providers` (não no
  `AppModule`), para manter toda a instrumentação encapsulada no módulo.
- Deve ser importado uma única vez em `AppModule` (`src/app.module.ts`).

### RF6 — Registro no `AppModule`
- `MetricsModule` deve ser adicionado ao array `imports` de `AppModule`.
- Nenhum outro comportamento do `AppModule` (guards, outros módulos, `TypeOrmModule`) deve ser
  alterado por esta spec.

---

## 5. Tabela de métricas expostas

| Métrica | Tipo | Labels | Descrição |
| --- | --- | --- | --- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total de requisições HTTP recebidas pelo serviço. |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições HTTP, em segundos. |
| `process_cpu_user_seconds_total` | Counter | — | Métrica padrão do Node.js (via `collectDefaultMetrics`). |
| `process_resident_memory_bytes` | Gauge | — | Métrica padrão do Node.js. |
| `nodejs_heap_size_total_bytes` | Gauge | — | Métrica padrão do Node.js. |
| `nodejs_eventloop_lag_seconds` | Gauge | — | Métrica padrão do Node.js. |
| *(demais métricas padrão de `collectDefaultMetrics`)* | — | — | Conjunto completo de métricas padrão do `prom-client` para o runtime Node.js. |

---

## 6. Critérios de aceite

- [ ] **CA1** — `prom-client` consta em `dependencies` no `package.json` do `products-service`.
- [ ] **CA2** — Com o serviço rodando (`npm run start:dev`), `curl -i http://localhost:3001/metrics`
  retorna **200** com header `Content-Type: text/plain; version=0.0.4; charset=utf-8` (ou
  equivalente gerado pelo `prom-client`).
- [ ] **CA3** — O corpo da resposta contém `# TYPE http_requests_total counter` e ao menos uma
  série com labels `method`, `route` e `status_code`.
- [ ] **CA4** — O corpo da resposta contém `# TYPE http_request_duration_seconds histogram`, com
  linhas `_bucket`, `_sum` e `_count`.
- [ ] **CA5** — O corpo da resposta contém métricas padrão do Node.js, por exemplo
  `process_cpu_user_seconds_total` e `nodejs_heap_size_total_bytes`.
- [ ] **CA6** — `GET /metrics` sem header `Authorization` retorna 200 (não 401) — a rota é
  pública mesmo com o `JwtAuthGuard` global ativo.
- [ ] **CA7** — Fazer requisições a `GET /products/<id1>` e `GET /products/<id2>` (dois IDs
  válidos diferentes) resulta em uma única série `http_requests_total` com
  `route="/products/:id"` — os valores de `id` não aparecem na label `route`.
- [ ] **CA8** — Fazer múltiplas requisições consecutivas a `GET /metrics` e confirmar, no corpo
  retornado, que não existe nenhuma série de `http_requests_total` (nem `http_request_duration_seconds`)
  com `route="/metrics"`.
- [ ] **CA9** — Uma requisição a uma rota inexistente (ex.: `GET /rota-que-nao-existe`) retorna
  404 e é contabilizada em `http_requests_total` com `status_code="404"`.
- [ ] **CA10** — Uma requisição a uma rota protegida sem token retorna 401 e é contabilizada em
  `http_requests_total` com `status_code="401"`.
- [ ] **CA11** — Com o `products-service` rodando na porta 3001 e a stack da SPEC 19
  (`observability-stack/`) no ar, após aguardar ao menos um ciclo de scrape (15s), o target
  `products-service` em `http://localhost:9090/targets` aparece como **UP**.

---

## 7. Dependências e sequência

Depende de:
- SPEC 19 (`../../docs/specs/criar-observability-stack-prometheus-grafana.md`) — Prometheus já
  configurado para fazer scrape de `:3001/metrics`.
- Spec [`02 - jwt-authentication`](./02%20-%20jwt-authentication.md) — mecanismo `@Public()` /
  `JwtAuthGuard` reaproveitado aqui.

Specs futuras (fora de escopo aqui): métricas de negócio customizadas (ex.: `products_created_total`),
dashboards no Grafana.
