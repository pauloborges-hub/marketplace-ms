# Spec: Criar a stack de observabilidade do marketplace-ms com Prometheus e Grafana

## Contexto

O `marketplace-ms` é composto por 5 serviços NestJS rodando no host (fora de container, em desenvolvimento local):

| Serviço | Porta |
| --- | --- |
| `users-service` | 3000 |
| `products-service` | 3001 |
| `checkout-service` | 3003 |
| `payments-service` | 3004 |
| `api-gateway` | 3005 |

Além disso, o projeto já possui uma infraestrutura de mensageria em pasta dedicada (`messaging-service/`), com um `docker-compose.yml` próprio e um `README.md`, subindo o RabbitMQ (portas `5672` AMQP e `15672` Management UI). Esse é o **padrão arquitetural de infraestrutura** que o projeto adota: cada peça de infra vive em sua própria pasta na raiz, com Docker Compose dedicado e README.

Precisamos criar a base de **observabilidade** seguindo exatamente esse padrão: uma pasta dedicada com Docker Compose contendo **Prometheus** (coleta de métricas) e **Grafana** (dashboards). Como os serviços NestJS rodam no host e o Prometheus roda em container, o Prometheus precisa alcançar o host via `host.docker.internal`.

Esta spec cobre **apenas a infraestrutura** da stack de observabilidade. A instrumentação dos serviços (expor `/metrics`), a criação de dashboards e o alerting são explicitamente fora de escopo (ver seção "Fora de escopo") e serão tratados em specs futuras.

## Objetivo

1. Criar a pasta `observability-stack/` na raiz do projeto, seguindo o mesmo padrão de `messaging-service/`.
2. Subir, via um único `docker-compose up -d`, uma stack com **Prometheus** (porta `9090`) e **Grafana** (porta `3010`).
3. Configurar o Prometheus para fazer scrape do endpoint `/metrics` dos 5 serviços rodando no host, via `host.docker.internal`.
4. Provisionar o Grafana já iniciando com o **datasource Prometheus pré-configurado** (sem configuração manual pela UI).
5. Documentar a stack em um `README.md` e atualizar o mapa de portas do projeto.

## Fora de escopo

- **Instrumentar os serviços NestJS com métricas** (adicionar `prom-client`, expor `GET /metrics`). Será feito na próxima spec. Nesta spec, é esperado e aceito que os targets do Prometheus apareçam como `DOWN` até que os serviços exponham `/metrics`.
- **Criar dashboards no Grafana** (paineis, gráficos, provisioning de dashboards). Spec futura.
- **Configurar alerting** (Alertmanager, regras de alerta, notificações). Spec futura.
- **Adicionar qualquer outra ferramenta** além de Prometheus e Grafana (nada de Loki, Jaeger, Tempo, exporters de node/cAdvisor, etc.).
- Qualquer alteração de código nos 5 serviços ou no `messaging-service`.
- Autenticação/hardening de produção do Grafana ou do Prometheus (credenciais de produção, TLS, reverse proxy). Usaremos configuração de desenvolvimento local.

## Estrutura de pastas

Criar, na raiz do projeto, a seguinte estrutura:

```
observability-stack/
├── docker-compose.yml
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   └── provisioning/
│       └── datasources/
│           └── datasource.yml
└── README.md
```

- `docker-compose.yml` — orquestra os containers de Prometheus e Grafana.
- `prometheus/prometheus.yml` — configuração de scrape do Prometheus, montada no container.
- `grafana/provisioning/datasources/datasource.yml` — provisioning do datasource Prometheus, montado no diretório de provisioning do Grafana.
- `README.md` — instruções básicas de uso.

## Requisitos

### 1. Docker Compose (`observability-stack/docker-compose.yml`)

Deve definir dois serviços, seguindo o estilo do `messaging-service/docker-compose.yml` (imagens oficiais, `container_name` prefixado com `marketplace-`, `restart: unless-stopped`, volumes nomeados para persistência, comentários em PT-BR).

**Serviço `prometheus`:**
- Imagem oficial `prom/prometheus` (tag estável fixada, ex.: `prom/prometheus:v2.53.0`).
- `container_name: marketplace-prometheus`.
- Porta: `9090:9090`.
- Monta `./prometheus/prometheus.yml` em `/etc/prometheus/prometheus.yml` (read-only).
- Volume nomeado (ex.: `prometheus_data`) montado em `/prometheus` para persistência da TSDB.
- `extra_hosts` com `host.docker.internal:host-gateway`, garantindo que o container resolva o host em Linux (no Docker Desktop para macOS/Windows já funciona por padrão, mas a entrada torna o comportamento portável).
- `restart: unless-stopped`.

**Serviço `grafana`:**
- Imagem oficial `grafana/grafana` (tag estável fixada, ex.: `grafana/grafana:11.1.0`).
- `container_name: marketplace-grafana`.
- Porta: `3010:3000` (Grafana escuta em `3000` dentro do container; mapeamos para `3010` no host para evitar conflito com o `users-service`).
- Monta `./grafana/provisioning` em `/etc/grafana/provisioning` (read-only) para o provisioning automático.
- Volume nomeado (ex.: `grafana_data`) montado em `/var/lib/grafana` para persistência.
- Credenciais de admin de desenvolvimento via env (`GF_SECURITY_ADMIN_USER=admin`, `GF_SECURITY_ADMIN_PASSWORD=admin`), com comentário indicando que devem ser trocadas em produção (mesmo espírito do RabbitMQ no `messaging-service`).
- `depends_on: [prometheus]`.
- `restart: unless-stopped`.

**Volumes nomeados:** declarar `prometheus_data` e `grafana_data` na seção `volumes:`.

### 2. Configuração do Prometheus (`observability-stack/prometheus/prometheus.yml`)

- `global.scrape_interval` e `global.evaluation_interval` definidos (ex.: `15s`).
- Um bloco `scrape_configs` com **um job por serviço** (ou um job por serviço com `job_name` claro), cobrindo os 5 serviços, cada um apontando para `host.docker.internal:<porta>` no endpoint padrão `/metrics`:

| `job_name` | target |
| --- | --- |
| `api-gateway` | `host.docker.internal:3005` |
| `users-service` | `host.docker.internal:3000` |
| `products-service` | `host.docker.internal:3001` |
| `checkout-service` | `host.docker.internal:3003` |
| `payments-service` | `host.docker.internal:3004` |

- O `metrics_path` deve ser `/metrics` (é o padrão do Prometheus; pode ser omitido por ser default, mas, se explicitado, deve ser `/metrics`).
- Opcionalmente, incluir um job `prometheus` fazendo scrape de si mesmo (`localhost:9090`), prática comum e útil para validar que o próprio Prometheus está saudável.
- Comentários em PT-BR explicando que os targets rodam no host e por isso usam `host.docker.internal`.

### 3. Provisioning do datasource do Grafana (`observability-stack/grafana/provisioning/datasources/datasource.yml`)

- `apiVersion: 1`.
- Um datasource do tipo `prometheus`:
  - `name: Prometheus`.
  - `type: prometheus`.
  - `access: proxy`.
  - `url: http://prometheus:9090` (o Grafana alcança o Prometheus pelo nome do serviço na rede do Compose).
  - `isDefault: true`.
- O objetivo é que, ao subir a stack pela primeira vez, o Grafana já mostre o datasource "Prometheus" configurado e como padrão, **sem nenhuma configuração manual pela UI**.

### 4. README (`observability-stack/README.md`)

Documento curto, no mesmo estilo do `messaging-service/README.md`, contendo no mínimo:
- Título e uma linha descrevendo que é a stack de observabilidade (Prometheus + Grafana) do marketplace.
- Como subir: `docker-compose up -d` (executado de dentro de `observability-stack/`).
- Como derrubar: `docker-compose down`.
- URLs de acesso:
  - Prometheus: `http://localhost:9090`.
  - Grafana: `http://localhost:3010` (login `admin` / `admin`).
- Nota de que os 5 serviços NestJS precisam estar rodando no host e expondo `/metrics` para que os targets apareçam como `UP` (com referência de que a instrumentação vem em spec futura).

### 5. Mapa de portas atualizado

Registrar o mapa de portas consolidado do projeto, agora incluindo a stack de observabilidade. Ele deve constar no `README.md` da `observability-stack/` (e/ou em documentação de portas existente, se houver):

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

## Critérios de aceite

1. A pasta `observability-stack/` existe na raiz do projeto com a estrutura descrita na seção "Estrutura de pastas" (`docker-compose.yml`, `prometheus/prometheus.yml`, `grafana/provisioning/datasources/datasource.yml`, `README.md`).
2. `docker-compose config` executado dentro de `observability-stack/` é válido (não retorna erro de sintaxe).
3. `docker-compose up -d` dentro de `observability-stack/` sobe **dois** containers saudáveis: `marketplace-prometheus` e `marketplace-grafana`.
4. `http://localhost:9090` abre a UI do Prometheus.
5. Em `http://localhost:9090/targets` (ou `Status → Targets`), aparecem exatamente os 5 targets dos serviços — `api-gateway` (3005), `users-service` (3000), `products-service` (3001), `checkout-service` (3003), `payments-service` (3004) — todos apontando para `host.docker.internal`. É aceitável que estejam `DOWN` enquanto os serviços não expõem `/metrics` (instrumentação é da próxima spec).
6. `http://localhost:3010` abre a UI do Grafana e permite login com `admin` / `admin`.
7. Na UI do Grafana, em `Connections → Data sources`, o datasource **Prometheus** já aparece pré-configurado, com URL `http://prometheus:9090` e marcado como default — sem que nenhuma configuração manual tenha sido feita. O botão "Test"/"Save & test" do datasource retorna sucesso.
8. Nenhuma porta da stack de observabilidade conflita com os serviços existentes (Prometheus em `9090`, Grafana em `3010`; em particular, o Grafana **não** usa `3000`).
9. `docker-compose down` dentro de `observability-stack/` derruba os dois containers sem erro; os volumes nomeados (`prometheus_data`, `grafana_data`) persistem os dados entre `down`/`up` (sem `-v`).
10. Nenhum arquivo dos 5 serviços nem do `messaging-service` foi alterado (`git diff --stat` restrito a esses diretórios está vazio); a única adição é a pasta `observability-stack/` (mais, se aplicável, atualização de documentação de portas).
11. O `README.md` da `observability-stack/` contém as instruções de uso, as URLs de acesso e o mapa de portas atualizado incluindo Prometheus (9090) e Grafana (3010).

## Riscos e observações

- Em ambientes Docker Desktop (macOS/Windows), `host.docker.internal` já resolve o host automaticamente; em Docker Engine no Linux, a entrada `extra_hosts: ["host.docker.internal:host-gateway"]` no serviço `prometheus` é o que garante essa resolução — por isso ela é obrigatória nesta spec.
- Enquanto os serviços não forem instrumentados (próxima spec), os 5 targets aparecerão `DOWN` no Prometheus. Isso é o comportamento esperado e **não** é motivo de falha desta spec.
- As credenciais `admin`/`admin` do Grafana e a ausência de autenticação no Prometheus são adequadas apenas para desenvolvimento local — não usar em produção sem hardening (mesmo alerta já presente no `messaging-service` para o RabbitMQ).
- Fixar tags de imagem (em vez de `latest`) evita quebras silenciosas quando novas versões de Prometheus/Grafana forem publicadas; as versões sugeridas nesta spec podem ser ajustadas para as estáveis mais recentes no momento da implementação.
```