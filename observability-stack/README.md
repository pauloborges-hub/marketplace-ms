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

O Prometheus faz scrape do endpoint `/metrics` dos 5 serviços NestJS, que rodam no **host** (por isso `host.docker.internal`). Enquanto os serviços não expõem `/metrics`, os targets aparecem como `DOWN` em http://localhost:9090/targets — a instrumentação dos serviços virá em uma spec futura.

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
