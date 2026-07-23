# SPEC — Dashboards no Grafana + Métricas de Negócio

> **Status:** Proposta
> **Escopo:** `observability-stack`, `payments-service`, `checkout-service`
> **Depende de:** métricas HTTP já expostas em `/metrics` por todos os serviços (prom-client)
> **NÃO faz parte desta spec:** alerting, exporters de banco/RabbitMQ, mudanças de infra (Docker Compose do Prometheus/Grafana)

---

## 1. Objetivo

Dar visibilidade operacional e de negócio ao `marketplace-ms` através de:

1. **Métricas de negócio customizadas** em `payments-service` e `checkout-service`, expostas no mesmo endpoint `/metrics` já coletado pelo Prometheus.
2. **Dois dashboards versionados** e provisionados automaticamente no Grafana:
   - **Marketplace Overview** — saúde e throughput de toda a plataforma numa tela.
   - **Service Details** — mergulho por serviço (variável `$service`), com método RED por rota.
3. **Provisioning por JSON** — os dashboards vivem no repositório e sobem sozinhos, sem clique manual na UI.

O resultado esperado: abrir `http://localhost:3010`, escolher um dashboard e enxergar imediatamente quem está UP/DOWN, quanto tráfego cada serviço recebe, onde estão os erros e a latência, e quantos pagamentos/pedidos estão fluindo.

---

## 2. Contexto atual (fatos verificados no código)

| Serviço | Porta | `job` no Prometheus |
|---|---|---|
| `users-service` | 3000 | `users-service` |
| `products-service` | 3001 | `products-service` |
| `checkout-service` | 3003 | `checkout-service` |
| `payments-service` | 3004 | `payments-service` |
| `api-gateway` | 3005 | `api-gateway` |

- Prometheus (`prom/prometheus:v2.53.0`) faz scrape a cada **15s** via `host.docker.internal:<porta>/metrics`. O `job_name` de cada target é igual ao nome do serviço — usaremos o label `job` como identidade do serviço em todas as queries.
- Grafana (`grafana/grafana:11.1.0`) na porta **3010** (host) → 3000 (container), com datasource **Prometheus** provisionado como `isDefault: true` (uid padrão do datasource default).
- `observability-stack/grafana/provisioning` **já está montado** no container (`:/etc/grafana/provisioning:ro`). Basta criar a subpasta `dashboards/` — **nenhuma alteração no `docker-compose.yml` é necessária**.
- Cada serviço tem um `MetricsService` `@Global` (`metrics.module.ts`) com um **`Registry` local privado** e coleta:
  - `http_requests_total` — Counter, labels `method`, `route`, `status_code`
  - `http_request_duration_seconds` — Histogram, labels `method`, `route`, `status_code`
  - métricas padrão do Node via `collectDefaultMetrics` (ex.: `process_resident_memory_bytes`, `process_cpu_seconds_total`, `nodejs_heap_size_used_bytes`, `nodejs_eventloop_lag_seconds`, `nodejs_eventloop_lag_p99_seconds`).
- A rota é normalizada para o **padrão registrado** (ex.: `/payments/:orderId`) e rotas não-casadas viram `unmatched` — cardinalidade controlada.

> **Decisão de design importante:** o `Registry` do `MetricsService` é **privado** e a classe expõe apenas métodos (não há getter público do registry). Portanto, métricas de negócio **não** devem criar um `new Counter()` solto num service de negócio — devem ser **novos métodos no `MetricsService`**, registrados no mesmo registry privado. Isso mantém uma única fonte de verdade por processo e preserva a proteção contra "metric already registered" nos e2e em série.

---

## 3. Métricas de negócio customizadas

Todas as métricas abaixo são **Counters** (monotônicos, só sobem), registrados no `Registry` privado do respectivo `MetricsService` e consultados em queries com `rate()`/`increase()`.

### 3.1 `payments-service`

Adicionar ao `MetricsService` de `payments-service`:

| Métrica | Tipo | Labels | Semântica |
|---|---|---|---|
| `payments_processed_total` | Counter | — | Incrementa **uma vez por pagamento efetivamente processado** (aprovado **ou** rejeitado). |
| `payments_approved_total` | Counter | — | Incrementa quando `status === APPROVED`. |
| `payments_rejected_total` | Counter | `reason` | Incrementa quando `status === REJECTED`. `reason` = `payment.rejectionReason` (fallback `"unknown"`). |

**Invariante:** `payments_processed_total == payments_approved_total + sum(payments_rejected_total)`.

**Ponto de instrumentação** — `PaymentsService.processPayment()` (`payments-service/src/payments/payments.service.ts`), **após** o segundo `save` (status já definido) e **antes** do `return payment`:

```ts
// pseudo-código do ponto de chamada
this.metricsService.recordPaymentProcessed(payment.status, payment.rejectionReason);
```

```ts
// novos métodos no MetricsService de payments-service
recordPaymentProcessed(status: PaymentStatus, rejectionReason?: string | null) {
  this.paymentsProcessedTotal.inc();
  if (status === PaymentStatus.APPROVED) {
    this.paymentsApprovedTotal.inc();
  } else if (status === PaymentStatus.REJECTED) {
    this.paymentsRejectedTotal.inc({ reason: rejectionReason ?? 'unknown' });
  }
}
```

**Cuidados obrigatórios:**
- **Idempotência (RN5):** `processPayment` retorna cedo (`return existing`) quando o pagamento já está num status final. Esse caminho **NÃO** deve incrementar os counters — senão um redelivery infla o negócio. Instrumentar apenas o fluxo que realmente decidiu o status neste processamento.
- **Cardinalidade do label `reason`:** só usar valores fechados vindos do gateway (`rejectionReason`). Nunca colocar `orderId`, `userId`, mensagens livres ou valores de amount no label.

### 3.2 `checkout-service`

Adicionar ao `MetricsService` de `checkout-service`:

| Métrica | Tipo | Labels | Semântica |
|---|---|---|---|
| `orders_created_total` | Counter | — | Incrementa a cada pedido persistido com sucesso no checkout. |
| `rabbitmq_messages_published_total` | Counter | `queue` | Incrementa a cada mensagem publicada com sucesso no broker. `queue` identifica o destino lógico. |

**Ponto de instrumentação `orders_created_total`** — `OrdersService.checkout()` (`checkout-service/src/orders/orders.service.ts`), logo após o `orderRepository.save(...)` retornar o `order`:

```ts
this.metricsService.recordOrderCreated();
```

**Ponto de instrumentação `rabbitmq_messages_published_total`** — no fluxo de publicação. O destino real é o **exchange `payments` / routing key `payment.order`** (`PaymentQueueService.publishPaymentOrder`). Padronizar o valor do label `queue` como o destino lógico da publicação:

```ts
// após publish bem-sucedido em PaymentQueueService (ou RabbitmqService.publishMessage)
this.metricsService.recordMessagePublished('payment.order');
```

```ts
// novos métodos no MetricsService de checkout-service
recordOrderCreated() {
  this.ordersCreatedTotal.inc();
}
recordMessagePublished(queue: string) {
  this.rabbitmqMessagesPublishedTotal.inc({ queue });
}
```

**Cuidados obrigatórios:**
- Só incrementar `rabbitmq_messages_published_total` **quando a publicação foi confirmada** (o `publishMessage` atual faz early-return silencioso se o canal não existe e engole erros — nesses casos **não** contar). A métrica precisa refletir mensagens realmente enviadas.
- O label `queue` deve ter um conjunto **pequeno e fixo** de valores (nomes lógicos de fila/routing key). Nunca derivar de dados da mensagem.

### 3.3 Fiação (comum aos dois serviços)

- `MetricsService` já é `@Global` e exportado — os services de negócio (`PaymentsService`, `OrdersService`, `PaymentQueueService`) apenas **injetam** `MetricsService` no construtor. Nenhum novo módulo é necessário.
- Registrar cada novo Counter com `registers: [this.registry]` no construtor do `MetricsService`, junto dos counters HTTP existentes.
- **Não** tocar em `getMetrics()`/`onModuleDestroy()` — os novos counters já saem no mesmo dump e são limpos por `registry.clear()`.

---

## 4. Dashboard "Marketplace Overview"

**Arquivo:** `observability-stack/grafana/provisioning/dashboards/marketplace-overview.json`
**uid:** `marketplace-overview`
**Refresh:** `15s` · **Time range padrão:** `now-1h`

Objetivo: uma tela de "torre de controle". Todo painel agrega **por serviço** usando o label `job`.

| # | Painel | Tipo | Query PromQL |
|---|---|---|---|
| 1 | **Status por serviço** | Stat / State timeline (mapear `1→UP` verde, `0→DOWN` vermelho) | `up{job=~"api-gateway\|users-service\|products-service\|checkout-service\|payments-service"}` |
| 2 | **Throughput geral** (req/s por serviço) | Time series | `sum by (job) (rate(http_requests_total[5m]))` |
| 3 | **Taxa de erro 5xx** | Time series (%) | `sum by (job) (rate(http_requests_total{status_code=~"5.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))` |
| 4 | **Taxa de erro 4xx** | Time series (%) | `sum by (job) (rate(http_requests_total{status_code=~"4.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))` |
| 5 | **Latência P95 por serviço** | Time series (s) | `histogram_quantile(0.95, sum by (job, le) (rate(http_request_duration_seconds_bucket[5m])))` |
| 6 | **Memória residente por serviço** | Time series (bytes → unit `bytes`) | `process_resident_memory_bytes{job=~".+-service\|api-gateway"}` |
| 7 | **Pagamentos processados** (aprov. vs rej.) | Time series | `sum(rate(payments_approved_total[5m]))` e `sum by (reason) (rate(payments_rejected_total[5m]))` |
| 8 | **Taxa de aprovação de pagamentos** | Stat / Gauge (%) | `sum(rate(payments_approved_total[5m])) / sum(rate(payments_processed_total[5m]))` |
| 9 | **Pedidos criados** | Time series | `sum(rate(orders_created_total[5m]))` |
| 10 | **Mensagens publicadas no broker** | Time series | `sum by (queue) (rate(rabbitmq_messages_published_total[5m]))` |

**Notas de layout:**
- Linha 1: painel de Status (largura total) — o "semáforo" da plataforma.
- Linha 2: Throughput + Latência P95 lado a lado.
- Linha 3: Erros 5xx + 4xx lado a lado.
- Linha 4: Memória (largura total).
- Linha 5 (seção "Negócio"): Pagamentos, Taxa de aprovação, Pedidos, Mensagens.
- Unidades: painéis de latência em `s`, memória em `bytes`, taxas de erro/aprovação em `percentunit`.

---

## 5. Dashboard "Service Details"

**Arquivo:** `observability-stack/grafana/provisioning/dashboards/service-details.json`
**uid:** `service-details`
**Refresh:** `15s` · **Time range padrão:** `now-1h`

### 5.1 Variável de template `$service`

| Propriedade | Valor |
|---|---|
| Nome | `service` |
| Tipo | Query |
| Datasource | Prometheus (default) |
| Query | `label_values(up, job)` |
| Multi-value | não |
| Include All | não |
| Current padrão | `payments-service` |

Todos os painéis filtram por `{job="$service"}`.

### 5.2 Painéis

| # | Painel | Tipo | Query PromQL |
|---|---|---|---|
| 1 | **Rate por rota** (RED · Rate) | Time series | `sum by (route) (rate(http_requests_total{job="$service"}[5m]))` |
| 2 | **Errors por rota** (RED · Errors, 5xx) | Time series | `sum by (route) (rate(http_requests_total{job="$service", status_code=~"5.."}[5m]))` |
| 3 | **Duration P50** | Time series (s) | `histogram_quantile(0.50, sum by (route, le) (rate(http_request_duration_seconds_bucket{job="$service"}[5m])))` |
| 4 | **Duration P95** | Time series (s) | `histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket{job="$service"}[5m])))` |
| 5 | **Duration P99** | Time series (s) | `histogram_quantile(0.99, sum by (route, le) (rate(http_request_duration_seconds_bucket{job="$service"}[5m])))` |
| 6 | **Top rotas por volume** | Table (instant) | `topk(10, sum by (route) (rate(http_requests_total{job="$service"}[5m])))` |
| 7 | **Distribuição de status codes** | Pie chart (instant) | `sum by (status_code) (rate(http_requests_total{job="$service"}[5m]))` |
| 8 | **CPU do processo** | Time series (cores) | `rate(process_cpu_seconds_total{job="$service"}[5m])` |
| 9 | **Memória (heap usado / RSS)** | Time series (bytes) | `nodejs_heap_size_used_bytes{job="$service"}` e `process_resident_memory_bytes{job="$service"}` |
| 10 | **Event loop lag (P99)** | Time series (s) | `nodejs_eventloop_lag_p99_seconds{job="$service"}` |

**Notas:**
- Painéis 3/4/5 podem ser combinados num único gráfico com três séries (P50/P95/P99) por rota, ou separados; a spec aceita ambos desde que as três quantiles apareçam.
- Painel 6 (Table) e 7 (Pie) devem usar **query instantânea** (last value) para leitura correta.
- Se `$service` = `api-gateway`, os painéis Node.js continuam válidos (mesma stack prom-client).

---

## 6. Provisioning via JSON

### 6.1 Estrutura de arquivos (nova)

```
observability-stack/grafana/provisioning/
├── datasources/
│   └── datasource.yml          # já existe (Prometheus default)
└── dashboards/                 # NOVO
    ├── dashboards.yml          # provider que aponta para esta pasta
    ├── marketplace-overview.json
    └── service-details.json
```

### 6.2 Provider — `dashboards/dashboards.yml`

```yaml
apiVersion: 1

providers:
  - name: 'marketplace-dashboards'
    orgId: 1
    folder: 'Marketplace'
    type: file
    disableDeletion: false
    editable: true          # permite editar na UI para experimentar; a fonte de verdade é o JSON no repo
    allowUiUpdates: false    # mudanças de UI não sobrescrevem o arquivo versionado
    updateIntervalSeconds: 30
    options:
      path: /etc/grafana/provisioning/dashboards
      foldersFromFilesStructure: false
```

- `options.path` aponta para dentro do container — coberto pelo mount já existente `./grafana/provisioning:/etc/grafana/provisioning:ro`. **Sem mudança no Compose.**
- Como o mount é `:ro`, o container não escreve nos JSON; `allowUiUpdates: false` deixa isso explícito.

### 6.3 Regras para os JSON de dashboard

- Cada arquivo deve ter `uid` fixo (`marketplace-overview`, `service-details`) para links estáveis.
- Datasource nos painéis: usar `"datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" }` **ou** referenciar o datasource default. Como só existe um Prometheus e ele é `isDefault: true`, referenciar o default é suficiente e evita dependência de uid fixo.
- Não commitar campos voláteis: `"id"` deve ser `null`; remover `"__inputs"`/`"__requires"` de export manual quando possível.
- `schemaVersion` compatível com Grafana 11.x.
- Formatação: JSON com indentação de 2 espaços, uma métrica de negócio/HTTP por painel conforme seções 4 e 5.

### 6.4 Ativação

Como o volume de provisioning já está montado, basta **reiniciar o container do Grafana** para ele ler a nova pasta:

```bash
docker compose -f observability-stack/docker-compose.yml restart grafana
```

---

## 7. Referência rápida — PromQL essencial

| Intenção | Query |
|---|---|
| Serviço UP/DOWN | `up{job="payments-service"}` |
| Throughput por serviço | `sum by (job) (rate(http_requests_total[5m]))` |
| Throughput por rota | `sum by (route) (rate(http_requests_total{job="$service"}[5m]))` |
| Erro 5xx (razão) | `sum by (job) (rate(http_requests_total{status_code=~"5.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))` |
| Erro 4xx (razão) | `sum by (job) (rate(http_requests_total{status_code=~"4.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))` |
| Latência P50/P95/P99 | `histogram_quantile(0.95, sum by (job, le) (rate(http_request_duration_seconds_bucket[5m])))` |
| Latência P95 por rota | `histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket{job="$service"}[5m])))` |
| Top 10 rotas | `topk(10, sum by (route) (rate(http_requests_total{job="$service"}[5m])))` |
| Distribuição status code | `sum by (status_code) (rate(http_requests_total{job="$service"}[5m]))` |
| Memória residente | `process_resident_memory_bytes{job="$service"}` |
| Heap Node usado | `nodejs_heap_size_used_bytes{job="$service"}` |
| CPU (cores) | `rate(process_cpu_seconds_total{job="$service"}[5m])` |
| Event loop lag P99 | `nodejs_eventloop_lag_p99_seconds{job="$service"}` |
| Pagamentos aprovados/s | `sum(rate(payments_approved_total[5m]))` |
| Pagamentos rejeitados por motivo | `sum by (reason) (rate(payments_rejected_total[5m]))` |
| Taxa de aprovação | `sum(rate(payments_approved_total[5m])) / sum(rate(payments_processed_total[5m]))` |
| Pedidos criados/s | `sum(rate(orders_created_total[5m]))` |
| Mensagens publicadas por fila | `sum by (queue) (rate(rabbitmq_messages_published_total[5m]))` |

> **Janela `[5m]`:** com scrape de 15s há ~20 amostras na janela — suave e responsivo. Ajustar para `[1m]` em investigação de picos, `[15m]` para tendências.

---

## 8. Critérios de aceite

### 8.1 Métricas de negócio

- [ ] **CA-1** `GET http://localhost:3004/metrics` retorna as séries `payments_processed_total`, `payments_approved_total` e `payments_rejected_total`.
- [ ] **CA-2** Após um pagamento **aprovado**, `payments_approved_total` e `payments_processed_total` incrementam em 1; `payments_rejected_total` não muda.
- [ ] **CA-3** Após um pagamento **rejeitado**, `payments_rejected_total{reason="<motivo do gateway>"}` e `payments_processed_total` incrementam em 1; `payments_approved_total` não muda.
- [ ] **CA-4** Reprocessar o **mesmo `orderId`** já finalizado (redelivery/idempotência RN5) **não** altera nenhum dos três counters.
- [ ] **CA-5** `GET http://localhost:3003/metrics` retorna `orders_created_total` e `rabbitmq_messages_published_total`.
- [ ] **CA-6** Um checkout bem-sucedido incrementa `orders_created_total` em 1 e `rabbitmq_messages_published_total{queue="payment.order"}` em 1.
- [ ] **CA-7** Quando a publicação no broker **não ocorre** (canal indisponível), `rabbitmq_messages_published_total` **não** incrementa.
- [ ] **CA-8** Nenhum label de métrica de negócio contém identificadores de alta cardinalidade (`orderId`, `userId`, valores de amount, mensagens livres). `reason` e `queue` têm conjuntos de valores fechados.
- [ ] **CA-9** A suíte e2e existente de métricas (`test/metrics.e2e-spec.ts`) de ambos os serviços continua verde.

### 8.2 Prometheus

- [ ] **CA-10** No Prometheus (`http://localhost:9090`), as métricas de negócio aparecem com o label `job` correto (`payments-service` / `checkout-service`) após ≤30s do primeiro evento.

### 8.3 Dashboards / Grafana

- [ ] **CA-11** Os arquivos `dashboards.yml`, `marketplace-overview.json` e `service-details.json` existem sob `observability-stack/grafana/provisioning/dashboards/` e estão versionados no git.
- [ ] **CA-12** Após reiniciar o Grafana, os dois dashboards aparecem na pasta **Marketplace** **sem nenhuma importação manual**.
- [ ] **CA-13** "Marketplace Overview" mostra o status UP/DOWN dos 5 serviços e, com tráfego, exibe throughput, erros 4xx/5xx, P95, memória e os painéis de negócio com dados (não "No data").
- [ ] **CA-14** "Service Details" tem a variável `$service` populada com os 5 jobs; ao trocar de serviço, todos os painéis (RED por rota, top rotas, pie de status, CPU/memória/event loop) atualizam para o serviço selecionado.
- [ ] **CA-15** Nenhum painel referencia um datasource por uid inexistente — todos resolvem para o Prometheus default.
- [ ] **CA-16** `docker-compose.yml`, `prometheus.yml` e `datasource.yml` permanecem **inalterados** por esta entrega.

### 8.4 Fora de escopo (confirmação)

- [ ] **CA-17** Nenhuma regra de alerta, contact point ou notification policy foi adicionada.
- [ ] **CA-18** Nenhum exporter de banco de dados ou RabbitMQ foi introduzido.

---

## 9. Plano de validação manual (rápido)

```bash
# 1. Subir a stack de observabilidade (se ainda não estiver de pé)
docker compose -f observability-stack/docker-compose.yml up -d

# 2. Gerar tráfego / um checkout ponta-a-ponta para popular as métricas de negócio
#    (fluxo normal: adicionar item ao carrinho -> checkout -> pagamento consumido)

# 3. Conferir as métricas cruas
curl -s http://localhost:3004/metrics | grep -E '^payments_(processed|approved|rejected)_total'
curl -s http://localhost:3003/metrics | grep -E '^(orders_created_total|rabbitmq_messages_published_total)'

# 4. Conferir no Prometheus (targets UP e séries presentes)
open http://localhost:9090/targets

# 5. Abrir o Grafana e validar os dashboards
open http://localhost:3010   # admin / admin -> pasta "Marketplace"
```

---

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Contagem dupla no redelivery de pagamento | Instrumentar apenas o caminho que decide o status; o early-return de idempotência não conta (CA-4). |
| Cardinalidade explodindo via `reason`/`queue` | Restringir a valores fechados vindos do domínio; revisão no CA-8. |
| Publicação "silenciosa" contada como sucesso | Só incrementar após confirmação real de publish (CA-7). |
| Painel "No data" por datasource uid errado | Referenciar o Prometheus default em vez de uid fixo (CA-15). |
| Dashboard não aparece | Provider `dashboards.yml` com `options.path` dentro do mount existente + restart do Grafana (CA-12). |

---

## 11. Próximos passos (fora desta spec)

- **Alerting** (próxima spec): regras sobre taxa de erro 5xx, latência P95, `up == 0` e queda na taxa de aprovação de pagamentos.
- Exporters dedicados (Postgres, RabbitMQ) e painéis de infraestrutura.
