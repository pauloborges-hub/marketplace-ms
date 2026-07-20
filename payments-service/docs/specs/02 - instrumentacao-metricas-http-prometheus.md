# SPEC: Instrumentação de métricas HTTP com `prom-client` (`GET /metrics`)

> **Objetivo:** Expor, em `GET /metrics`, métricas HTTP no formato de exposição do Prometheus
> (`http_requests_total`, `http_request_duration_seconds`) mais as métricas padrão do Node.js,
> para que o `payments-service` deixe de aparecer como target `DOWN` no Prometheus provisionado
> pela SPEC 19 (`criar-observability-stack-prometheus-grafana`).
>
> **Escopo desta spec:** dependência `prom-client`, módulo `MetricsModule` global com
> `MetricsService`, `HttpMetricsInterceptor` e `MetricsController`, registro no `AppModule`, e
> **renomeação do endpoint `/metrics` já existente** (estatísticas do consumer RabbitMQ, formato
> JSON) para liberar o caminho `/metrics` para o formato de exposição do Prometheus (ver seção 1).
> **Fora de escopo:** métricas de negócio customizadas (ex.: pagamentos processados, taxa de
> sucesso do gateway) — virão em spec futura; dashboards no Grafana; qualquer alteração em
> `observability-stack/` (Prometheus/Grafana já estão configurados pela SPEC 19 e não devem ser
> tocados aqui); qualquer alteração de comportamento do `PaymentConsumerService`, `DlqController`
> ou do fluxo de consumo de filas.

---

## 1. Contexto e decisão importante: conflito de rota em `/metrics`

A SPEC 19 (`../../docs/specs/criar-observability-stack-prometheus-grafana.md`, na raiz do
projeto) subiu Prometheus (`:9090`) e Grafana (`:3010`) via `observability-stack/`, com o
Prometheus já configurado para fazer scrape de `GET http://host.docker.internal:3004/metrics` a
cada 15s (job `payments-service`).

**Diferente dos outros 4 serviços, o `payments-service` já expõe hoje um endpoint em
`GET /metrics`** — criado pela spec [`01 - processamento-de-pagamento`](./01%20-%20processamento-de-pagamento.md)
(seção `EventsModule`, arquivo `src/events/metrics/metrics.controller.ts`), que retorna, em
**JSON**, estatísticas internas do consumer RabbitMQ (`ConsumerMetrics`: total processado,
sucesso, falha, tempo médio, etc.), com sub-rotas `GET /metrics/health`, `GET /metrics/summary` e
`POST /metrics/reset`.

Isso **colide diretamente** com o requisito desta spec: o Prometheus espera, em `GET /metrics`,
uma resposta em **texto no formato de exposição do Prometheus** (`# HELP` / `# TYPE` / séries),
não JSON — os dois formatos não podem coexistir na mesma rota.

**Decisão desta spec:** renomear o controller existente de estatísticas do consumer, de
`@Controller('metrics')` para `@Controller('consumer-metrics')`, liberando `/metrics` para o
novo `MetricsController` de métricas HTTP no formato Prometheus. Isso é uma mudança de rota
proposital e necessária — não uma remoção de funcionalidade: todo o comportamento existente
(`ConsumerMetrics`, health, summary, reset) é preservado **integralmente**, apenas sob um novo
prefixo:

| Rota atual | Rota nova |
| --- | --- |
| `GET /metrics` | `GET /consumer-metrics` |
| `GET /metrics/health` | `GET /consumer-metrics/health` |
| `GET /metrics/summary` | `GET /consumer-metrics/summary` |
| `POST /metrics/reset` | `POST /consumer-metrics/reset` |

Isso diverge do critério CA12 da spec `01 - processamento-de-pagamento` (que previa esses
endpoints preservados sob `/metrics`) — divergência intencional, motivada pela impossibilidade de
dois formatos de resposta diferentes coexistirem na mesma rota, e pela necessidade de o
Prometheus (SPEC 19) conseguir fazer scrape do serviço. Não é necessário editar a spec `01`
retroativamente; este documento registra a decisão.

Também é importante notar que o `payments-service`, ao contrário dos outros 4 serviços, **não
possui nenhum guard de autenticação global nem por rota** (não há `AuthModule`, `JwtAuthGuard` ou
`@Public()` neste serviço hoje — todas as rotas já são publicamente acessíveis). Logo,
`GET /metrics` já nasce acessível sem token, sem necessidade de nenhuma marcação adicional.

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
- **Sem guard:** não há `@Public()` neste serviço; nada precisa ser feito além de criar a rota
  normalmente — ela já é pública por ausência de qualquer guard.
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

> **Atenção:** já existe `src/events/metrics/metrics.controller.ts` (estatísticas do consumer).
> Não confundir com o novo `src/metrics/metrics.controller.ts` desta spec — são dois controllers
> distintos, com responsabilidades e formatos de resposta totalmente diferentes. Sugere-se manter
> os nomes de classe distintos (ex.: renomear a classe existente para `ConsumerMetricsController`
> ao mover sua rota, evitando ambiguidade nos imports).

---

## 4. Requisitos funcionais

### RF1 — Renomear o endpoint de estatísticas do consumer (pré-requisito)
- Em `src/events/metrics/metrics.controller.ts`, alterar `@Controller('metrics')` para
  `@Controller('consumer-metrics')`.
- Nenhuma lógica interna do controller (`getMetrics`, `getHealth`, `getSummary`, `resetMetrics`)
  deve ser alterada — apenas o prefixo de rota.
- Atualizar quaisquer referências a essas rotas em testes e2e ou documentação do
  `payments-service`, se existirem.

### RF2 — Dependência
- Instalar `prom-client` como dependência de produção (`dependencies`, não `devDependencies`) do
  `payments-service`.

### RF3 — `MetricsService`
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
- Não deve expor nenhuma métrica de negócio (nada de contagem de pagamentos processados,
  sucesso/falha do gateway, etc. — isso inclui não migrar as métricas de `ConsumerMetrics` para
  o formato Prometheus nesta spec).

### RF4 — `HttpMetricsInterceptor`
- Deve ser um `NestInterceptor` registrado globalmente via `APP_INTERCEPTOR`, aplicado a toda
  requisição HTTP do serviço.
- Para cada requisição, deve capturar:
  - `method`: o verbo HTTP (`GET`, `POST`, etc.).
  - `route`: o **padrão** da rota (ex.: `/payments/:orderId`, `/consumer-metrics/health`), nunca a
    URL resolvida com valores reais. Se o Nest não conseguir resolver uma rota (ex.: 404 em
    caminho inexistente), a label `route` deve usar um valor fixo (ex.: `unmatched`) — nunca o
    caminho bruto da URL — para não gerar cardinalidade ilimitada de séries no Prometheus.
  - `status_code`: o código HTTP final da resposta (incluindo respostas de erro tratadas por
    exception filters), capturado de forma confiável — recomenda-se usar o evento `finish` da
    resposta HTTP (`res.on('finish', ...)`) para garantir que o valor não seja provisório.
  - `duration`: o tempo decorrido entre o início e o fim da requisição, em segundos.
- Deve incrementar `http_requests_total` e observar `http_request_duration_seconds` com essas
  labels, para toda requisição — incluindo as que resultam em erro (4xx/5xx), e incluindo as
  rotas de `/consumer-metrics/*` e `/dlq/*` (essas não são o endpoint `/metrics` do Prometheus,
  então continuam sendo contabilizadas normalmente).
- **Exceção:** requisições para `GET /metrics` (o novo endpoint desta spec) não devem gerar
  nenhum incremento de métrica (nem no counter, nem no histogram), evitando que o próprio
  endpoint de métricas infle suas contagens a cada scrape do Prometheus.

### RF5 — `MetricsController`
- Deve expor `GET /metrics`, retornando o corpo gerado por `MetricsService` (formato de exposição
  do Prometheus) com o `Content-Type` correto (`registry.contentType`, tipicamente
  `text/plain; version=0.0.4; charset=utf-8`).
- Não exige `@Public()` nem qualquer outro decorator de autorização — o serviço não possui guard
  global.
- Não deve exigir nenhum parâmetro, header ou body.

### RF6 — `MetricsModule`
- Deve ser um módulo `@Global()`, contendo `MetricsController` e provendo `MetricsService`.
- Deve registrar `HttpMetricsInterceptor` como `APP_INTERCEPTOR` em seus `providers` (não no
  `AppModule`), para manter toda a instrumentação encapsulada no módulo.
- Deve ser importado uma única vez em `AppModule` (`src/app.module.ts`).

### RF7 — Registro no `AppModule`
- `MetricsModule` deve ser adicionado ao array `imports` de `AppModule`.
- Nenhum outro comportamento do `AppModule` (`EventsModule`, `TypeOrmModule`) deve ser alterado
  por esta spec além do necessário para RF1.

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

As estatísticas de negócio do consumer RabbitMQ (`ConsumerMetrics`, em JSON) continuam
disponíveis em `GET /consumer-metrics` e não fazem parte desta tabela — não são métricas
Prometheus.

---

## 6. Critérios de aceite

- [ ] **CA1** — `prom-client` consta em `dependencies` no `package.json` do `payments-service`.
- [ ] **CA2** — Com o serviço rodando (`npm run start:dev`), `curl -i http://localhost:3004/metrics`
  retorna **200** com header `Content-Type: text/plain; version=0.0.4; charset=utf-8` (ou
  equivalente gerado pelo `prom-client`) — **não** mais o JSON de `ConsumerMetrics`.
- [ ] **CA3** — O corpo da resposta de `GET /metrics` contém `# TYPE http_requests_total counter`
  e ao menos uma série com labels `method`, `route` e `status_code`.
- [ ] **CA4** — O corpo da resposta contém `# TYPE http_request_duration_seconds histogram`, com
  linhas `_bucket`, `_sum` e `_count`.
- [ ] **CA5** — O corpo da resposta contém métricas padrão do Node.js, por exemplo
  `process_cpu_user_seconds_total` e `nodejs_heap_size_total_bytes`.
- [ ] **CA6** — `curl -i http://localhost:3004/consumer-metrics` retorna **200** com o mesmo JSON
  de `ConsumerMetrics` que antes era retornado em `GET /metrics` (total processado, sucesso,
  falha, taxa de sucesso, uptime, status).
- [ ] **CA7** — `GET /consumer-metrics/health`, `GET /consumer-metrics/summary` e
  `POST /consumer-metrics/reset` funcionam exatamente como as antigas rotas
  `/metrics/health`, `/metrics/summary` e `POST /metrics/reset` funcionavam.
- [ ] **CA8** — `GET /metrics` (novo endpoint) não exige nenhum header `Authorization` — retorna
  200 sempre, dado que o serviço não possui guard de autenticação.
- [ ] **CA9** — Fazer requisições a `GET /payments/<orderId1>` e `GET /payments/<orderId2>` (dois
  IDs válidos diferentes) resulta em uma única série `http_requests_total` com
  `route="/payments/:orderId"` — os valores de `orderId` não aparecem na label `route`.
- [ ] **CA10** — Fazer múltiplas requisições consecutivas a `GET /metrics` e confirmar, no corpo
  retornado, que não existe nenhuma série de `http_requests_total` (nem `http_request_duration_seconds`)
  com `route="/metrics"`.
- [ ] **CA11** — Uma requisição a `GET /consumer-metrics` **é** contabilizada normalmente em
  `http_requests_total` com `route="/consumer-metrics"` (só o endpoint `/metrics` em si é
  excluído da contagem, não as demais rotas do serviço).
- [ ] **CA12** — Uma requisição a uma rota inexistente (ex.: `GET /rota-que-nao-existe`) retorna
  404 e é contabilizada em `http_requests_total` com `status_code="404"`.
- [ ] **CA13** — Com o `payments-service` rodando na porta 3004 e a stack da SPEC 19
  (`observability-stack/`) no ar, após aguardar ao menos um ciclo de scrape (15s), o target
  `payments-service` em `http://localhost:9090/targets` aparece como **UP**.

---

## 7. Dependências e sequência

Depende de:
- SPEC 19 (`../../docs/specs/criar-observability-stack-prometheus-grafana.md`) — Prometheus já
  configurado para fazer scrape de `:3004/metrics`.
- Spec [`01 - processamento-de-pagamento`](./01%20-%20processamento-de-pagamento.md) — dona do
  endpoint `GET /metrics` original (estatísticas do consumer), renomeado por esta spec conforme
  seção 1.

Specs futuras (fora de escopo aqui): métricas de negócio customizadas (ex.:
`payments_processed_total`), dashboards no Grafana, eventual migração das estatísticas de
`ConsumerMetrics` para métricas nativas do Prometheus (hoje permanecem como endpoint JSON
separado em `/consumer-metrics`).
