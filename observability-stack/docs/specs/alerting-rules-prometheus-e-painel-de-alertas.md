# SPEC — Alerting rules no Prometheus + painel de alertas ativos no Grafana

> **Status:** Proposta
> **Escopo:** `observability-stack` (Prometheus + Grafana)
> **Depende de:** métricas HTTP e de negócio já expostas em `/metrics` pelos 5 serviços
> (SPECs 19–21) e dos dashboards já provisionados.
>
> **NÃO faz parte desta spec:**
> - **Alertmanager e notificações externas** (Slack, e-mail, PagerDuty) — nice-to-have futuro.
>   Nenhum contact point, notification policy ou container novo no Compose.
> - **Grafana Unified Alerting** — as regras vivem no **Prometheus**, em `alert.rules.yml`
>   versionado. O Grafana apenas **exibe** o estado.
> - Novas métricas ou alterações em métricas existentes.
> - Alterações nos dashboards além do **acréscimo** do painel de alertas em
>   `marketplace-overview.json` (nenhum painel existente muda de query, tipo ou posição).
> - Exporters de Postgres/RabbitMQ.

---

## 1. Objetivo

Fazer o Prometheus **decidir sozinho** quando algo está errado, em vez de depender de alguém olhando
um dashboard. Ao fim desta entrega:

1. `observability-stack/prometheus/alert.rules.yml` existe, versionado, com **6 regras**.
2. O Prometheus carrega essas regras e mostra o estado (`inactive` / `pending` / `firing`) em
   `http://localhost:9090/alerts`.
3. O dashboard **Marketplace Overview** ganha uma seção **Alertas** com a lista de alertas ativos e
   um contador — o "semáforo" da plataforma passa a incluir o que já disparou.

Sem Alertmanager, os alertas **não notificam ninguém** — ficam visíveis no Prometheus e no Grafana.
Isso é uma decisão explícita de escopo, não uma omissão.

---

## 2. Contexto atual (fatos verificados)

| Item | Situação |
|---|---|
| Prometheus | `prom/prometheus:v2.53.0`, container `marketplace-prometheus`, porta `9090` |
| Config | `observability-stack/prometheus/prometheus.yml`, montada como `:ro`; `global.scrape_interval: 15s`, `global.evaluation_interval: 15s`; **nenhum `rule_files`** |
| Jobs | `prometheus`, `api-gateway`, `users-service`, `products-service`, `checkout-service`, `payments-service` — o label `job` é a identidade do serviço |
| Serviços | rodam no **host**, alcançados via `host.docker.internal:<porta>` |
| Grafana | `grafana/grafana:11.1.0`, porta `3010`; provisioning montado `:ro` |
| Dashboard Overview | `grafana/provisioning/dashboards/marketplace-overview.json`, `uid: marketplace-overview`, `schemaVersion: 39`, variável de datasource `${datasource}`; painéis com `id` 1–10 e uma row `id: 100` ("Negócio"); o painel de maior `y` é o `id: 10` em `y: 39, h: 8` — **primeira linha livre: `y = 47`** |
| Métricas disponíveis | `up`, `http_requests_total{method,route,status_code}`, `http_request_duration_seconds_bucket`, `process_resident_memory_bytes`, `payments_processed_total`, `payments_approved_total`, `payments_rejected_total{reason}`, `orders_created_total`, `rabbitmq_messages_published_total{queue}` |

---

## 3. Arquivos alterados/criados

```
observability-stack/
├── docker-compose.yml                                   # ALTERADO — monta alert.rules.yml
├── prometheus/
│   ├── prometheus.yml                                   # ALTERADO — adiciona rule_files
│   └── alert.rules.yml                                  # NOVO
└── grafana/provisioning/dashboards/
    └── marketplace-overview.json                        # ALTERADO — acrescenta a seção "Alertas"
```

> **Nota sobre o escopo:** as SPECs anteriores pediam para **não** tocar em `prometheus.yml` e
> `docker-compose.yml`. Aqui a alteração é **inevitável e mínima**: sem `rule_files` o Prometheus não
> carrega regra nenhuma, e sem o volume o arquivo não existe dentro do container. São as duas únicas
> linhas de infraestrutura mexidas; scrape configs, portas, imagens e volumes existentes ficam
> intactos.

---

## 4. `prometheus/alert.rules.yml`

### 4.1 Estrutura

Dois grupos, separando **plataforma** de **negócio** — grupos são a unidade de avaliação e de
ordenação do Prometheus, e a separação facilita silenciar/ajustar um lado sem mexer no outro.

```yaml
groups:
  - name: marketplace-platform
    interval: 15s
    rules:
      # ServiceDown, HighErrorRate, HighLatencyP95, HighMemoryUsage

  - name: marketplace-business
    interval: 15s
    rules:
      # NoPaymentsProcessed, HighPaymentRejectionRate
```

`interval: 15s` alinha a avaliação ao `scrape_interval`; avaliar mais rápido que o scrape só gasta
CPU repetindo o mesmo resultado.

### 4.2 Convenção de labels e annotations (obrigatória em todas as regras)

| Campo | Regra |
|---|---|
| `labels.severity` | `critical` \| `warning` \| `info` — exatamente estes três valores |
| `annotations.summary` | Uma linha, com o serviço afetado via `{{ $labels.job }}` |
| `annotations.description` | Contexto acionável: o que foi medido, o valor atual (`{{ $value }}`), o limiar e por quanto tempo |

Não inventar labels adicionais (`team`, `runbook`, etc.) — sem Alertmanager, ninguém as consome.

### 4.3 Grupo `marketplace-platform`

#### R1 — `ServiceDown` (critical)

```yaml
- alert: ServiceDown
  expr: up{job=~"api-gateway|users-service|products-service|checkout-service|payments-service"} == 0
  for: 30s
  labels:
    severity: critical
  annotations:
    summary: "Serviço {{ $labels.job }} está fora do ar"
    description: "O target {{ $labels.instance }} (job {{ $labels.job }}) não responde ao scrape há mais de 30s."
```

- O regex **exclui deliberadamente o job `prometheus`**: o Prometheus alertando sobre si mesmo é
  inútil (se ele cair, não avalia regra alguma).
- `for: 30s` = 2 ciclos de scrape. Menos que isso transforma qualquer restart de `npm run start:dev`
  em alerta.
- É o único `critical`: serviço fora significa requisições falhando **agora**.

#### R2 — `HighErrorRate` (warning)

```yaml
- alert: HighErrorRate
  expr: |
    sum by (job) (rate(http_requests_total{status_code=~"5.."}[5m]))
      /
    sum by (job) (rate(http_requests_total[5m]))
      > 0.1
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: "Taxa de erro 5xx alta em {{ $labels.job }}"
    description: "{{ $labels.job }} está com {{ $value | humanizePercentage }} de respostas 5xx (limiar: 10%) na janela de 5 minutos."
```

- **Só 5xx**, nunca 4xx: `401`/`404`/`422` são o cliente errando, não o serviço quebrando; incluí-los
  faria a regra disparar com um token expirado.
- **Sem tráfego não dispara:** numerador vazio ⇒ a divisão não produz série para aquele `job`; e
  `0/0` produz `NaN`, que falha a comparação `> 0.1`. Não é preciso guarda extra.
- ⚠️ **Interação com os health checks:** com as specs de health check em vigor, `/health` responde
  **503** quando uma dependência cai — e o `503` **é contabilizado** em `http_requests_total`. Em um
  serviço com pouco tráfego, um poll de health a cada 15s pode, sozinho, levar a razão de 5xx acima
  de 10% e disparar esta regra. **Isso é aceito e desejado**: significa que o serviço está de fato
  degradado. Se virar ruído em ambiente de desenvolvimento, a correção é reduzir o poll — não
  excluir `/health` da métrica.

#### R3 — `HighLatencyP95` (warning)

```yaml
- alert: HighLatencyP95
  expr: |
    histogram_quantile(
      0.95,
      sum by (job, le) (rate(http_request_duration_seconds_bucket[5m]))
    ) > 2
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: "Latência P95 alta em {{ $labels.job }}"
    description: "P95 de {{ $labels.job }} em {{ $value | humanizeDuration }} (limiar: 2s) na janela de 5 minutos."
```

- Agrega por `job`, não por `route` — alerta é sobre o serviço; o detalhe por rota está no dashboard
  **Service Details**.
- `sum by (job, le)` antes do `histogram_quantile` é obrigatório: quantil sobre buckets não agregados
  dá resultado errado.
- Sem tráfego, todos os buckets têm `rate` 0 ⇒ `histogram_quantile` retorna `NaN` ⇒ não dispara.

#### R4 — `HighMemoryUsage` (warning)

```yaml
- alert: HighMemoryUsage
  expr: process_resident_memory_bytes{job=~"api-gateway|users-service|products-service|checkout-service|payments-service"} > 536870912
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Uso de memória alto em {{ $labels.job }}"
    description: "{{ $labels.job }} usando {{ $value | humanize1024 }}B de RSS (limiar: 512MB) há mais de 2 minutos."
```

- `536870912` = 512 × 1024 × 1024. Escrever o número literal (o Prometheus **não** aceita `512Mi` em
  expressão); manter o comentário do cálculo no arquivo.
- Mesmo regex de jobs do `ServiceDown`, excluindo o `prometheus`.
- `for: 2m` filtra picos de GC — um Node.js pode encostar no limiar por segundos antes de coletar.

### 4.4 Grupo `marketplace-business`

#### R5 — `NoPaymentsProcessed` (info)

```yaml
- alert: NoPaymentsProcessed
  expr: |
    (sum(increase(payments_processed_total[5m])) or vector(0)) == 0
      and
    (sum(up{job="payments-service"}) > 0)
  for: 5m
  labels:
    severity: info
  annotations:
    summary: "Nenhum pagamento processado nos últimos 5 minutos"
    description: "payments_processed_total não incrementou na janela de 5 minutos, com o payments-service no ar. Pode indicar fila parada, consumidor sem canal AMQP ou simplesmente ausência de tráfego."
```

- **`or vector(0)` é obrigatório:** se a série `payments_processed_total` ainda não existe (processo
  recém-subido, nenhum pagamento desde o boot), `sum(increase(...))` retorna **vetor vazio** e a
  comparação `== 0` não produz resultado — o alerta **nunca dispararia** justamente no cenário que
  ele deveria pegar. `or vector(0)` materializa o zero.
- **A guarda `sum(up{job="payments-service"}) > 0` evita alerta duplicado:** com o serviço fora, quem
  deve disparar é o `ServiceDown` (critical), não este. Ambos os lados do `and` são vetores sem
  labels, então o matching padrão casa — não é preciso `on()`.
- **Tempo total até disparar ≈ 10 minutos** (janela de 5m + `for: 5m`). Intencional: sem o `for`, o
  alerta dispararia a cada boot do ambiente.
- ⚠️ **Este alerta vai disparar em ambiente de desenvolvimento ocioso.** É exatamente por isso que a
  severidade é **`info`**, e não `warning`: ele é um indicador de fluxo, não um defeito.

#### R6 — `HighPaymentRejectionRate` (warning)

```yaml
- alert: HighPaymentRejectionRate
  expr: |
    sum(rate(payments_rejected_total[5m]))
      /
    sum(rate(payments_processed_total[5m]))
      > 0.5
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Taxa de rejeição de pagamentos acima de 50%"
    description: "{{ $value | humanizePercentage }} dos pagamentos foram rejeitados na janela de 5 minutos (limiar: 50%). Verificar o gateway de pagamento e os motivos em payments_rejected_total{reason}."
```

- `sum(...)` sem `by` descarta o label `reason` de `payments_rejected_total` — sem isso a divisão
  não casaria com o denominador, que não tem `reason`.
- Sem pagamentos, `0/0` ⇒ `NaN` ⇒ não dispara.
- ⚠️ **Sensibilidade a volume baixo:** com 1 pagamento processado e 1 rejeitado, a razão é 100% e o
  alerta dispara. Aceito nesta entrega (o limiar pedido é 50% puro). Se virar ruído, a variante
  recomendada — a ser adotada em ajuste posterior, não agora — é acrescentar um piso de volume:
  `and (sum(increase(payments_processed_total[5m])) >= 5)`.

### 4.5 Tabela-resumo

| Alerta | Grupo | Severidade | `for` | Limiar | Dispara quando |
|---|---|---|---|---|---|
| `ServiceDown` | platform | `critical` | 30s | `up == 0` | Um dos 5 serviços não responde ao scrape |
| `HighErrorRate` | platform | `warning` | 1m | > 10% | Razão de 5xx sobre o total, por `job`, em 5m |
| `HighLatencyP95` | platform | `warning` | 1m | > 2s | P95 de duração HTTP, por `job`, em 5m |
| `HighMemoryUsage` | platform | `warning` | 2m | > 512MB | RSS do processo Node.js |
| `NoPaymentsProcessed` | business | `info` | 5m | == 0 | Nenhum incremento em `payments_processed_total` em 5m, com o serviço no ar |
| `HighPaymentRejectionRate` | business | `warning` | 2m | > 50% | Rejeitados / processados em 5m |

---

## 5. `prometheus/prometheus.yml` — alteração

Acrescentar **um único bloco**, no topo do arquivo (após `global:`). Nada mais muda:

```yaml
# Regras de alerta avaliadas a cada `evaluation_interval` (15s).
# O caminho é o de dentro do container, montado pelo docker-compose.yml.
rule_files:
  - /etc/prometheus/alert.rules.yml
```

- Os 6 `scrape_configs` permanecem **idênticos**.
- **Não** adicionar bloco `alerting:` / `alertmanagers:` — não há Alertmanager nesta entrega, e um
  alvo inexistente enche o log do Prometheus de erro de conexão a cada avaliação.

---

## 6. `docker-compose.yml` — alteração

No serviço `prometheus`, acrescentar **uma linha** ao array `volumes`:

```yaml
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/alert.rules.yml:/etc/prometheus/alert.rules.yml:ro   # NOVO
      - prometheus_data:/prometheus
```

- Montagem `:ro` — o arquivo versionado é a fonte de verdade.
- Montar o arquivo individualmente (e não o diretório) mantém a consistência com o mount já
  existente.
- **Nada mais no Compose muda:** imagens, tags, portas, `extra_hosts`, `restart`, o serviço `grafana`
  e os volumes nomeados ficam intactos.
- ⚠️ O `--web.enable-lifecycle` **não** está habilitado, então não há reload via HTTP. Aplicar
  mudanças com `docker compose restart prometheus` (ou `up -d` para pegar o volume novo — um mount
  novo exige **recriar** o container, `restart` sozinho não basta na primeira vez).

---

## 7. Painel de alertas ativos no Grafana

### 7.1 Como o Grafana enxerga os alertas

Sem Alertmanager e sem Grafana Alerting, a fonte é a série sintética que o **próprio Prometheus**
gera: `ALERTS{alertname, alertstate, severity, job, ...}`, valor `1`, com `alertstate` em
`pending` ou `firing`. Consultar essa métrica é o caminho suportado para exibir estado de regras do
Prometheus num painel do Grafana.

### 7.2 Alterações em `marketplace-overview.json`

**Regra de ouro:** apenas **acrescentar** ao array `panels`. Nenhum painel existente (`id` 1–10, row
`id: 100`) muda de `gridPos`, query, tipo ou título. A seção nova vai **ao final**, a partir de
`y: 47` (primeira linha livre), o que garante diff limpo e zero risco de regressão nos painéis atuais.

| # | Elemento | `id` | Tipo | `gridPos` |
|---|---|---|---|---|
| 1 | Row **"Alertas"** | `101` | `row` | `{ h: 1, w: 24, x: 0, y: 47 }` |
| 2 | **Alertas ativos** | `11` | `table` | `{ h: 8, w: 18, x: 0, y: 48 }` |
| 3 | **Alertas disparando** | `12` | `stat` | `{ h: 8, w: 6, x: 18, y: 48 }` |

#### Painel `id: 11` — "Alertas ativos" (table)

| Propriedade | Valor |
|---|---|
| `datasource` | `{ "type": "prometheus", "uid": "${datasource}" }` — igual aos demais painéis |
| `targets[0].expr` | `ALERTS{alertstate="firing"}` |
| `targets[0].instant` | `true` — tabela mostra o estado **agora**, não uma série temporal |
| `targets[0].format` | `"table"` |
| Transformação | `organize`: ocultar `Time`, `Value`, `__name__`, `instance`; renomear `alertname` → `Alerta`, `severity` → `Severidade`, `job` → `Serviço`, `alertstate` → `Estado` |
| Field override | Colorir a coluna `Severidade` por mapeamento de valor: `critical` → vermelho, `warning` → laranja, `info` → azul |
| Estado vazio | Sem alertas firing, a tabela fica vazia — resultado **correto** e legível |

#### Painel `id: 12` — "Alertas disparando" (stat)

| Propriedade | Valor |
|---|---|
| `datasource` | `{ "type": "prometheus", "uid": "${datasource}" }` |
| `targets[0].expr` | `count(ALERTS{alertstate="firing"}) or vector(0)` |
| `options.reduceOptions.calcs` | `["lastNotNull"]` (mesmo padrão do painel `id: 8`) |
| `thresholds` | `0` → verde; `1` → laranja; `3` → vermelho (modo `absolute`) |
| `unit` | `short` |

- `or vector(0)` é obrigatório: sem nenhum alerta ativo a série `ALERTS` não existe e o painel
  mostraria **"No data"** em vez de **`0`** — que é justamente a informação boa.

### 7.3 Restrições do JSON

- Manter `"id": null` no topo, `uid: "marketplace-overview"` e `schemaVersion: 39`.
- `pluginVersion: "11.1.0"` nos painéis novos, como nos existentes.
- Indentação de 2 espaços, coerente com o arquivo atual.
- **Não** tocar em `service-details.json` nem em `dashboards.yml`.

---

## 8. Ativação

```bash
cd observability-stack

# 1. validar a sintaxe das regras ANTES de reiniciar (config inválida derruba o Prometheus)
docker run --rm -v "$PWD/prometheus:/p" prom/prometheus:v2.53.0 \
  promtool check rules /p/alert.rules.yml

# 2. recriar o container (mount novo exige recreate, não só restart)
docker compose up -d prometheus

# 3. validar que a config foi aceita
docker compose logs --tail=30 prometheus | grep -i -E "error|rule"

# 4. o Grafana só precisa reler os dashboards
docker compose restart grafana
```

---

## 9. Critérios de aceite

### 9.1 Arquivos e carga das regras

- [ ] **CA-1** — `observability-stack/prometheus/alert.rules.yml` existe, está versionado no git e
  passa em `promtool check rules` sem erro nem warning.
- [ ] **CA-2** — `prometheus.yml` contém o bloco `rule_files` apontando para
  `/etc/prometheus/alert.rules.yml`, e os **6 `scrape_configs` estão inalterados** (diff limitado ao
  bloco novo).
- [ ] **CA-3** — `docker-compose.yml` monta `alert.rules.yml` em `:ro`; imagens, tags, portas,
  `extra_hosts` e o serviço `grafana` estão inalterados (diff limitado a **uma linha**).
- [ ] **CA-4** — `http://localhost:9090/rules` lista os **dois grupos** (`marketplace-platform`,
  `marketplace-business`) com **6 regras** no total, todas em estado `ok` (nenhuma com erro de
  avaliação).
- [ ] **CA-5** — `http://localhost:9090/alerts` lista os 6 alertas pelo nome; com a plataforma
  saudável e com tráfego, todos aparecem como `inactive` (exceto `NoPaymentsProcessed`, ver CA-10).
- [ ] **CA-6** — Não existe bloco `alerting:`/`alertmanagers:` em `prometheus.yml`, nenhum container
  novo no Compose e nenhum contact point/notification policy no Grafana.

### 9.2 Comportamento de cada regra (testável)

- [ ] **CA-7 — `ServiceDown`** — Parar o `products-service` (Ctrl+C). Em ≤ 45s, o alerta aparece
  como `firing` em `/alerts` com `job="products-service"` e `severity="critical"`. Ao subir o
  serviço, volta a `inactive` em ≤ 30s.
- [ ] **CA-8 — `HighErrorRate`** — Com o Postgres de um serviço parado, gerar tráfego que resulte em
  5xx por ~2 minutos até a razão passar de 10%. O alerta fica `pending` por 1m e depois `firing`,
  com o `job` correto. *(Verificar a razão na query
  `sum by (job)(rate(http_requests_total{status_code=~"5.."}[5m])) / sum by (job)(rate(http_requests_total[5m]))`.)*
- [ ] **CA-9 — `HighLatencyP95` / `HighMemoryUsage`** — Ambas avaliam sem erro em `/rules` e a
  expressão, colada no `/graph` do Prometheus, retorna resultado coerente (vazio com a plataforma
  saudável). Disparo real não é exigido no aceite — validar **abaixando temporariamente o limiar**
  (ex.: `> 0.01` e `> 1048576`), confirmando o `firing`, e **restaurando os valores originais**.
- [ ] **CA-10 — `NoPaymentsProcessed`** — Com o `payments-service` no ar e **sem** pagamentos por
  ~10 minutos, o alerta fica `firing` com `severity="info"`. Executando um checkout ponta-a-ponta,
  volta a `inactive` em ≤ 5 minutos.
- [ ] **CA-11 — `NoPaymentsProcessed` não duplica** — Com o `payments-service` **parado**, apenas
  `ServiceDown` fica `firing`; `NoPaymentsProcessed` **não** dispara (efeito da guarda `up > 0`).
- [ ] **CA-12 — `HighPaymentRejectionRate`** — Forçando rejeições no gateway fake até passar de 50%
  na janela de 5m, o alerta fica `firing` após 2m, com `severity="warning"`.
- [ ] **CA-13 — Sem tráfego, sem ruído** — Com a plataforma no ar e ociosa (sem requisições),
  `HighErrorRate`, `HighLatencyP95` e `HighPaymentRejectionRate` permanecem `inactive` — nenhuma
  delas dispara por divisão `0/0`.
- [ ] **CA-14 — Annotations úteis** — Em qualquer alerta `firing`, `summary` e `description`
  renderizados em `/alerts` mostram o **nome do serviço** e o **valor medido** (nenhum `{{ ... }}`
  literal, nenhum `<no value>`).

### 9.3 Grafana

- [ ] **CA-15** — Após `docker compose restart grafana`, o dashboard **Marketplace Overview** exibe a
  row **"Alertas"** ao final, com os painéis "Alertas ativos" e "Alertas disparando".
- [ ] **CA-16** — Com um alerta em `firing` (ex.: cenário do CA-7), a tabela lista uma linha com
  nome do alerta, severidade e serviço; o stat mostra a contagem correspondente.
- [ ] **CA-17** — Sem nenhum alerta ativo, o stat mostra **`0`** (não "No data") e a tabela aparece
  vazia.
- [ ] **CA-18** — Os painéis `id` 1–10 e a row `id: 100` do `marketplace-overview.json` estão
  **inalterados** — mesma `gridPos`, mesma query, mesmo título (verificar pelo diff do git).
- [ ] **CA-19** — `service-details.json`, `dashboards.yml` e `datasource.yml` estão inalterados.

### 9.4 Fora de escopo (confirmação)

- [ ] **CA-20** — Nenhuma métrica nova foi criada e nenhum código de serviço foi alterado por esta
  entrega.
- [ ] **CA-21** — Nenhum exporter de Postgres/RabbitMQ foi introduzido.

---

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Regra com sintaxe inválida derruba o Prometheus no boot | `promtool check rules` **antes** do restart (CA-1, passo 1 da seção 8) |
| Volume novo não aparece com `docker compose restart` | Usar `docker compose up -d prometheus` (recreate) — documentado na seção 6 e 8 |
| `NoPaymentsProcessed` disparando junto com `ServiceDown` | Guarda `sum(up{job="payments-service"}) > 0` (CA-11) |
| `NoPaymentsProcessed` nunca disparar por série inexistente | `or vector(0)` (R5) |
| Painel "No data" em vez de `0` | `or vector(0)` no stat (CA-17) |
| `HighErrorRate` disparando por causa do próprio `/health` em 503 | Documentado em R2 como comportamento aceito; correção é reduzir o poll, não excluir a rota da métrica |
| `HighPaymentRejectionRate` disparando com 1 pagamento | Documentado em R6, com a variante de piso de volume pronta para adoção posterior |
| Alertas configurados mas ninguém sabe que existem (sem notificação) | Painel de alertas no dashboard mais visto (seção 7); Alertmanager é o próximo passo explícito |
| Regressão silenciosa nos painéis existentes do Overview | Acréscimo ao final do array `panels` a partir de `y: 47`; CA-18 verifica pelo diff |

---

## 11. Próximos passos (fora desta spec)

- **Alertmanager** + notificações (Slack/e-mail), com agrupamento, inibição (`ServiceDown` inibindo
  `HighErrorRate` do mesmo `job`) e silences.
- Alertas sobre o **broker** e o **banco** com exporters dedicados (profundidade de fila, DLQ com
  mensagens, conexões do Postgres).
- Alertas derivados dos health checks: `orders_created_total` subindo sem
  `rabbitmq_messages_published_total` acompanhar (pedido criado sem publicação).
- Piso de volume em `HighPaymentRejectionRate` e revisão dos limiares com dados históricos reais.
