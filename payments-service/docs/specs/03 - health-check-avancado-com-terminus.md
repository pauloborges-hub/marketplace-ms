# SPEC: Health check avançado com `@nestjs/terminus` (PostgreSQL + RabbitMQ)

> **Status:** Proposta
> **Serviço:** `payments-service` (porta `3004`)
> **Objetivo:** Migrar o `GET /health` artesanal para `@nestjs/terminus`, **acrescentando a
> verificação de RabbitMQ** ao check de PostgreSQL que já existe, e devolvendo **503** quando
> qualquer dependência estiver fora.
>
> **Fora de escopo:** readiness/liveness probes (conceito de Kubernetes — não implementar);
> notificações externas; alteração de métricas existentes; alteração do `ConsumerMetricsController`
> (`GET /consumer-metrics/health`); regras de alerta no Prometheus
> (ver `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`).

---

## 1. Contexto atual (fatos verificados no código)

| Item | Situação hoje |
|---|---|
| Endpoint | `GET /health` em `src/payments/health.controller.ts`, declarado no `PaymentsModule` |
| Implementação | `HealthController` artesanal: `dataSource.query('SELECT 1')`, `catch` → `ServiceUnavailableException({ status: 'error', database: 'down' })`; sucesso → `{ status: 'ok', database: 'up' }` |
| Cobertura | `test/health.e2e-spec.ts` (**CA11**) afirma `GET /health` → 200 com corpo **exato** `{ status: 'ok', database: 'up' }` |
| Banco | `TypeOrmModule.forRoot(databaseConfig)` no `AppModule`; `localhost:5435`, database `payments_db` |
| Broker | `RabbitmqService` (`src/events/rabbitmq/rabbitmq.service.ts`) com `amqplib` cru; URL de `RABBITMQ_URL`, default `amqp://admin:admin@localhost:5672` |
| `EventsModule` | Declara `RabbitmqService` em `providers` mas **não o exporta** |
| Guard global | **Nenhum** — o `AppModule` não registra `APP_GUARD`; não existe decorator `@Public()` neste serviço |
| Métricas | `HttpMetricsMiddleware` aplicado a `*`, conta tudo exceto `/metrics` |
| Endpoint homônimo | `GET /consumer-metrics/health` (`src/events/metrics/metrics.controller.ts`) — health **do consumidor**, rota diferente, **permanece inalterado** |

### 1.1 O que está faltando hoje

O check de banco já é real (mérito da spec 01), mas **RabbitMQ não é verificado**. Este serviço é
essencialmente um **consumidor**: se ele perder o broker, para de processar pagamentos e mesmo assim
responde `200` em `/health`. `RabbitmqService.connect()` engole o erro de conexão e o processo sobe
normalmente sem broker — falha silenciosa que esta spec fecha.

Ganhos secundários da migração para Terminus: formato de resposta padronizado entre os 5 serviços,
timeout explícito no ping do banco (hoje inexistente) e agregação de múltiplos indicadores.

---

## 2. Dependências

```bash
npm install @nestjs/terminus @nestjs/microservices amqp-connection-manager
```

| Pacote | Versão | Por quê |
|---|---|---|
| `@nestjs/terminus` | `^11.0.0` | Framework de health check (compatível com `@nestjs/core` 11.x) |
| `@nestjs/microservices` | `^11.0.0` | Peer requerido pelo `MicroserviceHealthIndicator` |
| `amqp-connection-manager` | `^4.1.14` | Driver usado pelo transporte `Transport.RMQ` |

`@nestjs/typeorm`, `typeorm`, `pg` e `amqplib` já estão instalados.

> ⚠️ **Risco de peer dependency:** o `amqplib` instalado é **2.0.1** e `amqp-connection-manager`
> declara peer em faixas mais antigas. Se o `npm install` acusar conflito, **não** forçar com
> `--force`/`--legacy-peer-deps` sem antes avaliar o **Plano B** da seção 4.4 (dispensar o
> `MicroserviceHealthIndicator` e ficar só com o indicador customizado, que não exige nenhum dos dois
> pacotes novos). Registrar a decisão no PR. O mesmo dilema aparece no `checkout-service` — **os dois
> serviços devem seguir o mesmo caminho**.

---

## 3. Estrutura de arquivos

```
src/health/
├── health.module.ts
├── health.controller.ts            # substitui src/payments/health.controller.ts
└── indicators/
    └── rabbitmq-channel.health.ts  # indicador customizado (RF5)
```

Arquivo removido: `src/payments/health.controller.ts`.

---

## 4. Requisitos funcionais

### RF1 — Exportar o `RabbitmqService`
- Adicionar `exports: [RabbitmqService]` ao `EventsModule` (`src/events/events.module.ts`).
- **Obrigatório instanciar apenas uma vez:** declarar `RabbitmqService` em `providers` do
  `HealthModule` criaria uma segunda instância, com uma conexão AMQP paralela, e o health check
  inspecionaria um canal que não é o usado pelo `PaymentConsumerService`.
- ⚠️ **Atenção ao ciclo de módulos:** `EventsModule` já importa `PaymentsModule`. O `HealthModule`
  deve importar `EventsModule` e ser importado pelo `AppModule` — **não** pelo `PaymentsModule`, o
  que fecharia o ciclo `PaymentsModule → HealthModule → EventsModule → PaymentsModule`.

### RF2 — `HealthModule`
- Importa `TerminusModule`, `EventsModule` e `ConfigModule`.
- Declara `HealthController` em `controllers` e `RabbitmqChannelHealthIndicator` em `providers`.
- Importado no array `imports` do `AppModule` (`src/app.module.ts`).
- ⚠️ O `AppModule` **não** registra `ConfigModule.forRoot({ isGlobal: true })` (diferente dos demais
  serviços) — o `ConfigModule` é importado pontualmente pelo `EventsModule`. O `HealthModule` deve,
  portanto, importar `ConfigModule` explicitamente para injetar o `ConfigService`.

### RF3 — `HealthController`
- `@Controller('health')` + `@Get()` → `GET /health`.
- **Não** precisa de `@Public()` — este serviço não tem guard global (e o decorator não existe aqui).
- Handler com `@HealthCheck()`, executando três indicadores:

```ts
@Get()
@HealthCheck()
check() {
  return this.health.check([
    () => this.db.pingCheck('database', { timeout: 1500 }),
    () =>
      this.microservice.pingCheck<RmqOptions>('rabbitmq', {
        transport: Transport.RMQ,
        options: {
          urls: [this.config.get<string>('RABBITMQ_URL', 'amqp://admin:admin@localhost:5672')],
        },
        timeout: 3000,
      }),
    () => this.rabbitChannel.isHealthy('rabbitmq-channel'),
  ]);
}
```

- Chaves obrigatórias e exatas: **`database`**, **`rabbitmq`**, **`rabbitmq-channel`**.
- A URL do broker **deve** vir do `ConfigService` (`RABBITMQ_URL`), com o mesmo default do
  `RabbitmqService` — nunca hard-coded.

### RF4 — Indicador `rabbitmq` (Terminus)
- `MicroserviceHealthIndicator.pingCheck` com `Transport.RMQ` e `timeout: 3000`.
- **Semântica:** valida que o broker está no ar e aceita conexões. Abre um cliente AMQP temporário e
  o fecha — **não** inspeciona a conexão que o serviço mantém.

### RF5 — Indicador customizado `rabbitmq-channel`
> Complementar ao RF4 e **obrigatório**: sozinho, o `MicroserviceHealthIndicator` reportaria `up`
> num cenário em que o broker está de pé mas o `RabbitmqService` deste processo nunca conectou (ou
> perdeu a conexão) — exatamente a falha silenciosa da seção 1.1, que aqui significa **pagamentos
> não sendo consumidos**.

- Classe `RabbitmqChannelHealthIndicator` em `src/health/indicators/rabbitmq-channel.health.ts`.
- Implementada com a API de indicadores customizados do Terminus (`HealthIndicatorService`),
  injetando o `RabbitmqService` exportado pelo `EventsModule` (RF1).
- Regra: **`up`** se `rabbitmqService.getChannel()` retornar um canal definido; **`down`** caso
  contrário, com `message` indicando que o serviço está sem canal AMQP ativo (pagamentos não estão
  sendo consumidos).
- Deve ser **síncrono e barato** (leitura de campo em memória) — sem I/O, sem abrir conexão, sem
  publicar mensagem de teste.

### RF6 — Remoção do health antigo
- Excluir `src/payments/health.controller.ts` e removê-lo de `controllers` no `PaymentsModule`.
- Dois handlers para `GET /health` fariam o Nest resolver para o primeiro registrado, ignorando a
  verificação nova.
- `GET /consumer-metrics/health` (`ConsumerMetricsController`) **não** é tocado — é outra rota, com
  outro propósito (saúde do consumidor/DLQ).

### RF7 — Atualização do teste e2e existente
`test/health.e2e-spec.ts` afirma o corpo **exato** `{ status: 'ok', database: 'up' }` e **vai
quebrar** com o novo formato. O teste deve ser atualizado para:

- Montar o módulo de teste com `HealthModule` (e o que ele exigir) no lugar de `PaymentsModule`.
- Afirmar **status 200** e, no corpo, `status === 'ok'` e `details.database.status === 'up'` —
  usando asserções **parciais** (`expect(body.details.database.status).toBe('up')`), não
  `.expect({...})` com objeto exato, que voltaria a acoplar o teste ao formato inteiro.
- Cobrir também os indicadores de RabbitMQ **se** o ambiente de teste tiver broker disponível; caso
  contrário, restringir a asserção ao `database` e documentar a limitação no próprio arquivo de
  teste.
- Manter a referência ao critério de origem (`CA11` da spec 01) no nome do teste, para rastreabilidade.

### RF8 — Contrato de resposta

**200 — tudo operante**
```json
{
  "status": "ok",
  "info": {
    "database":         { "status": "up" },
    "rabbitmq":         { "status": "up" },
    "rabbitmq-channel": { "status": "up" }
  },
  "error": {},
  "details": { "...": "espelha info + error" }
}
```

**503 — qualquer indicador `down`** (o Terminus agrega: um `down` ⇒ 503)
```json
{
  "status": "error",
  "info":  { "database": { "status": "up" } },
  "error": {
    "rabbitmq":         { "status": "down", "message": "..." },
    "rabbitmq-channel": { "status": "down", "message": "..." }
  },
  "details": { "...": "espelha info + error" }
}
```

> **Mudança de contrato consciente:** sai `{ status, database }` plano, entra o envelope do Terminus.
> O único consumidor no repositório é o `api-gateway`, que avalia **apenas o status HTTP**
> (`health-check.service.ts`) — não quebra. O teste e2e local é atualizado no RF7.

---

## 5. Interação com métricas (informativo, não exige mudança)

`GET /health` continua contabilizado em `http_requests_total{route="/health"}`, incluindo os `503` —
intencional. Não adicionar exceção para `/health` no `HttpMetricsMiddleware`.

---

## 6. Critérios de aceite

### Dependências e fiação
- [ ] **CA1** — `@nestjs/terminus`, `@nestjs/microservices` e `amqp-connection-manager` constam em
  `dependencies` (ou, se o Plano B da seção 2 foi adotado, apenas `@nestjs/terminus`, com a decisão
  registrada no PR e **igual à do `checkout-service`**).
- [ ] **CA2** — `EventsModule` exporta `RabbitmqService`; o `HealthModule` o injeta e **não** o
  redeclara em `providers`.
- [ ] **CA3** — A aplicação sobe sem erro de dependência circular (`npm run start:dev` inicia e loga
  `💳 Payments Service running on port 3004`).

### Caminho feliz
- [ ] **CA4** — Com Postgres e RabbitMQ no ar, `curl -i http://localhost:3004/health` retorna **200**
  com `"status":"ok"` e os três indicadores em `"status":"up"`.

### Falhas de dependência
- [ ] **CA5** — Com o Postgres da porta 5435 parado, `GET /health` retorna **503** com `database` em
  `error`.
- [ ] **CA6** — Com o RabbitMQ parado e o serviço reiniciado em seguida, `GET /health` retorna **503**
  com **`rabbitmq`** e **`rabbitmq-channel`** em `error`.
- [ ] **CA7** — Com o serviço rodando e conectado, parar o RabbitMQ faz `GET /health` passar de 200
  para **503** sem reiniciar o serviço.
- [ ] **CA8** — Com o RabbitMQ fora, `GET /health` responde em menos de **5s**, não ficando pendurado.
- [ ] **CA9** — Restaurando as dependências, `GET /health` volta a **200**. *(Observação esperada:
  `rabbitmq-channel` pode permanecer `down` até o serviço reconectar — o `RabbitmqService` atual não
  implementa reconexão automática. Se ocorrer, registrar como known issue no PR.)*

### Regressão
- [ ] **CA10** — `src/payments/health.controller.ts` não existe mais e `PaymentsModule` não o
  referencia.
- [ ] **CA11** — `GET /consumer-metrics/health` continua respondendo exatamente como antes (rota,
  corpo e status inalterados), e o teste `test/metrics.e2e-spec.ts` que o exercita continua verde.
- [ ] **CA12** — `test/health.e2e-spec.ts` atualizado conforme RF7 e **verde**.
- [ ] **CA13** — `npm run build`, `npm run lint` e toda a suíte (`npm test` + e2e) continuam verdes.
- [ ] **CA14** — Nenhum arquivo em `src/metrics/` foi alterado; nenhum comportamento de
  publicação/consumo do `RabbitmqService` foi alterado (a spec apenas **lê** o estado do canal).

---

## 7. Validação manual

```bash
# 1. tudo no ar
curl -s http://localhost:3004/health | jq            # status ok, 3 indicadores up

# 2. derrubar só o broker
docker stop <rabbitmq>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3004/health   # 503
curl -s http://localhost:3004/health | jq '.error'                      # rabbitmq* down

# 3. o health do consumidor continua intacto
curl -s http://localhost:3004/consumer-metrics/health | jq

# 4. religar broker, derrubar o banco
docker start <rabbitmq>
docker stop <container-do-postgres-payments>   # porta 5435
curl -s http://localhost:3004/health | jq '.error'                      # database down

docker start <container-do-postgres-payments>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3004/health   # 200
```

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Dependência circular `PaymentsModule → HealthModule → EventsModule → PaymentsModule` | `HealthModule` é importado pelo `AppModule`, nunca pelo `PaymentsModule` (RF1, CA3) |
| `ConfigService` indisponível (não há `ConfigModule` global neste serviço) | `HealthModule` importa `ConfigModule` explicitamente (RF2) |
| Segunda instância de `RabbitmqService` com conexão paralela | `EventsModule` exporta; `HealthModule` só injeta (CA2) |
| Conflito de peer deps com `amqplib` 2.0.1 | Avaliado antes do install; Plano B documentado; decisão alinhada com o `checkout-service` |
| Regressão silenciosa no teste e2e CA11 | RF7 atualiza o teste com asserções parciais (CA12) |
| Confusão entre `/health` e `/consumer-metrics/health` | RF6 preserva o segundo; CA11 verifica |

---

## 9. Dependências e sequência

- **Depende de:** spec [`01 - processamento-de-pagamento`](./01%20-%20processamento-de-pagamento.md)
  (`HealthController` atual, `EventsModule`, `RabbitmqService`).
- **Relacionada:** `checkout-service/docs/specs/05 - health-check-avancado-com-terminus.md` (mesma
  decisão de dependências) e `api-gateway/docs/specs/02 - health-check-avancado-com-terminus.md`.
- **Consumida por:** `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`.
