# 📊 Observability Stack

Stack de observabilidade do marketplace com **Prometheus** (métricas) e **Grafana** (dashboards).

## 🚀 Como usar

Executar de dentro de `observability-stack/`:

### Subir a stack

```bash
docker-compose up -d
```

### Derrubar a stack

```bash
docker-compose down
```

> `docker-compose down` (sem `-v`) preserva os volumes `prometheus_data` e `grafana_data`, mantendo os dados entre reinícios.

## 🔗 Acesso

| Ferramenta | URL | Login |
| --- | --- | --- |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3010 | `admin` / `admin` |

O Grafana já sobe com o datasource **Prometheus** pré-configurado (via provisioning) e marcado como padrão.

> ⚠️ As credenciais `admin`/`admin` e a ausência de autenticação no Prometheus são apenas para desenvolvimento local — **MUDAR EM PRODUÇÃO**.

## 📈 Targets

O Prometheus faz scrape do endpoint `/metrics` dos 5 serviços NestJS, que rodam no **host** (por isso `host.docker.internal`). O estado de cada target fica em http://localhost:9090/targets — serviço que não estiver rodando aparece como `DOWN`.

## 🚨 Alertas

As regras vivem no **Prometheus**, em [`prometheus/alert.rules.yml`](prometheus/alert.rules.yml) — arquivo versionado é a fonte de verdade. O Grafana apenas **exibe** o estado.

| Alerta | Grupo | Severidade | `for` | Dispara quando |
| --- | --- | --- | --- | --- |
| `ServiceDown` | platform | `critical` | 30s | Um dos 5 serviços não responde ao scrape (`up == 0`) |
| `HighErrorRate` | platform | `warning` | 1m | Mais de 10% de respostas 5xx no serviço, em 5m |
| `HighLatencyP95` | platform | `warning` | 1m | P95 de duração HTTP acima de 2s, em 5m |
| `HighMemoryUsage` | platform | `warning` | 2m | RSS do processo Node.js acima de 512MB |
| `NoPaymentsProcessed` | business | `info` | 5m | Nenhum pagamento processado em 5m, com o `payments-service` no ar |
| `HighPaymentRejectionRate` | business | `warning` | 2m | Mais de 50% dos pagamentos rejeitados, em 5m |

- Estado das regras: http://localhost:9090/rules — alertas ativos: http://localhost:9090/alerts
- No Grafana, o dashboard **Marketplace Overview** tem a seção **Alertas** ao final, com a lista dos alertas disparando e o contador.

> ⚠️ **Não há Alertmanager**: os alertas **não notificam ninguém** (sem Slack, e-mail ou PagerDuty). Ficam visíveis no Prometheus e no Grafana. É uma decisão explícita de escopo — notificações são o próximo passo.

> `NoPaymentsProcessed` **vai disparar em ambiente de desenvolvimento ocioso** — é por isso que a severidade dele é `info`: indica ausência de fluxo, não defeito.

### Alterando as regras

O `--web.enable-lifecycle` não está habilitado, então não há reload via HTTP:

```bash
# Validar a sintaxe ANTES de reiniciar — config inválida derruba o Prometheus no boot.
# O entrypoint da imagem é o próprio `prometheus`, daí o --entrypoint promtool.
docker run --rm --entrypoint promtool -v "$PWD/prometheus:/etc/prometheus" \
  prom/prometheus:v2.53.0 check config /etc/prometheus/prometheus.yml

# Mount novo exige recriar o container; `restart` sozinho não basta na primeira vez.
docker compose up -d prometheus
```

## 🗺️ Mapa de portas do projeto

| Componente | Porta (host) | Observação |
| --- | --- | --- |
| `users-service` | 3000 | |
| `products-service` | 3001 | |
| `checkout-service` | 3003 | |
| `payments-service` | 3004 | |
| `api-gateway` | 3005 | |
| Grafana | 3010 | mapeado de `3000` interno do container |
| RabbitMQ (AMQP) | 5672 | `messaging-service` |
| Prometheus | 9090 | |
| RabbitMQ (Management UI) | 15672 | `messaging-service` |
