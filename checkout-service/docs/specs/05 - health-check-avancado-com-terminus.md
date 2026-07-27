# SPEC: Health check avançado com `@nestjs/terminus` (PostgreSQL + RabbitMQ)

> **Status:** Proposta
> **Serviço:** `checkout-service` (porta `3003`)
> **Objetivo:** Substituir o `GET /health` estático por um health check **real**, que verifique
> PostgreSQL (`TypeOrmHealthIndicator`) **e** RabbitMQ (`MicroserviceHealthIndicator` +
> indicador da conexão viva do próprio serviço), devolvendo **503** quando qualquer dependência
> estiver fora.
>
> **Fora de escopo:** readiness/liveness probes (conceito de Kubernetes — não implementar);
> notificações externas; alteração de métricas existentes; regras de alerta no Prometheus
> (ver `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`).

---

## 1. Contexto atual (fatos verificados no código)

| Item | Situação hoje |
|---|---|
| Endpoint | `GET /health` em `src/app.controller.ts`, decorado com `@Public()` |
| Implementação | `AppService.getHealth()` retorna literal `{ status: 'ok', service: 'checkout-service' }` |
| Verificação de dependências | **Nenhuma** — responde `200` com Postgres **e** RabbitMQ fora do ar |
| Banco | `TypeOrmModule.forRoot(databaseConfig)` no `AppModule`; `localhost:5437`, database `checkout_db` |
| Broker | `RabbitmqService` (`src/events/rabbitmq/rabbitmq.service.ts`) com `amqplib` cru; URL de `RABBITMQ_URL`, default `amqp://admin:admin@localhost:5672` |
| Guard global | `JwtAuthGuard` via `APP_GUARD`; rotas liberadas com `@Public()` |
| Métricas | `HttpMetricsInterceptor` global (`APP_INTERCEPTOR`), conta tudo exceto `/metrics` |
| `EventsModule` | Já **exporta** `RabbitmqService` e `PaymentQueueService` |

### 1.1 O problema específico deste serviço

`RabbitmqService.connect()` **engole a falha de conexão** e o serviço sobe normalmente sem broker:

```ts
} catch (error) {
  this.logger.warn('⚠️ Failed to connect to RabbitMQ, cotinuing wihout message queue:', ...);
}
```

E `publishMessage()` faz early-return silencioso quando não há canal. Ou seja: **hoje é possível o
checkout responder 200 em `/health`, aceitar pedidos e nunca publicar `payment.order`** — falha
silenciosa que só aparece quando o cliente reclama que o pagamento não foi processado. Fechar essa
lacuna é o principal valor desta spec.

---

## 2. Dependências

```bash
npm install @nestjs/terminus @nestjs/microservices amqp-connection-manager
```

| Pacote | Versão | Por quê |
|---|---|---|
| `@nestjs/terminus` | `^11.0.0` | Framework de health check (compatível com `@nestjs/core` 11.x) |
| `@nestjs/microservices` | `^11.0.0` | Peer requerido pelo `MicroserviceHealthIndicator` |
| `amqp-connection-manager` | `^4.1.14` | Driver que o transporte `Transport.RMQ` usa por baixo |

`@nestjs/typeorm`, `typeorm`, `pg` e `amqplib` já estão instalados.

> ⚠️ **Risco de peer dependency:** o `amqplib` instalado aqui é **2.0.1**, e `amqp-connection-manager`
> declara peer em faixas mais antigas de `amqplib`. Se o `npm install` acusar conflito de peers,
> **não** resolver com `--force`/`--legacy-peer-deps` sem antes avaliar o **Plano B** da seção 4.3
> (dispensar o `MicroserviceHealthIndicator` e usar somente o indicador customizado, que não exige
> nenhum dos dois pacotes novos). Registrar no PR qual caminho foi seguido.

---

## 3. Estrutura de arquivos

```
src/health/
├── health.module.ts
├── health.controller.ts
└── indicators/
    └── rabbitmq-channel.health.ts    # indicador customizado (RF4)
```

---

## 4. Requisitos funcionais

### RF1 — `HealthModule`
- Importa `TerminusModule` e `EventsModule` (este último para injetar o `RabbitmqService` já
  exportado — **não** instanciar um segundo `RabbitmqService`, que abriria uma conexão paralela).
- Declara `HealthController` em `controllers` e `RabbitmqChannelHealthIndicator` em `providers`.
- Importado no array `imports` do `AppModule`. Nenhuma outra alteração no `AppModule`.

### RF2 — `HealthController`
- `@Controller('health')` + `@Get()` → `GET /health`.
- Decorado com `@Public()` — sem isso o `JwtAuthGuard` global devolve 401 e o `api-gateway` passa a
  ver o checkout como `unhealthy`.
- Handler com `@HealthCheck()`, executando três indicadores:

```ts
@Public()
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

- Chaves obrigatórias e exatas: **`database`**, **`rabbitmq`**, **`rabbitmq-channel`** — os critérios
  de aceite e o `api-gateway` dependem desses nomes.
- A URL do broker **deve** vir do `ConfigService` (`RABBITMQ_URL`), com o mesmo default do
  `RabbitmqService`. Nunca hard-coded — divergência entre os dois faria o health check validar um
  broker diferente do que o serviço realmente usa.

### RF3 — Indicador `rabbitmq` (Terminus)
- Usa `MicroserviceHealthIndicator.pingCheck` com `Transport.RMQ`.
- `timeout: 3000` (ms) obrigatório — o handshake AMQP com um broker inacessível pode demorar.
- **Semântica:** valida que **o broker está no ar e aceita conexões**. Abre um cliente AMQP
  temporário e o fecha ao fim da checagem — **não** inspeciona a conexão que o serviço mantém.

### RF4 — Indicador customizado `rabbitmq-channel`
> Complementar ao RF3 e **obrigatório**: sozinho, o `MicroserviceHealthIndicator` reportaria `up`
> num cenário em que o broker está de pé mas o `RabbitmqService` deste processo perdeu (ou nunca
> estabeleceu) a conexão — exatamente a falha silenciosa descrita na seção 1.1.

- Classe `RabbitmqChannelHealthIndicator` em `src/health/indicators/rabbitmq-channel.health.ts`.
- Implementada com a API de indicadores customizados do Terminus (`HealthIndicatorService`),
  injetando o `RabbitmqService` exportado pelo `EventsModule`.
- Regra: **`up`** se `rabbitmqService.getChannel()` retornar um canal definido; **`down`** caso
  contrário, com `message` explicando que o serviço está sem canal AMQP ativo (publicações estão
  sendo descartadas).
- Deve ser **síncrono e barato** (leitura de um campo em memória) — não faz I/O, não abre conexão,
  não publica mensagem de teste.

### RF5 — Remoção do health antigo
- Remover o handler `getHealth()` de `src/app.controller.ts` e o método `getHealth()` de
  `src/app.service.ts`. Dois handlers para `GET /health` fariam o Nest resolver para o primeiro
  registrado, ignorando a verificação real.
- `GET /` (`getHello`) permanece inalterado.

### RF6 — Contrato de resposta

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

**503 — broker fora, banco ok** (o Terminus agrega: **qualquer** indicador `down` ⇒ 503)
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

---

## 5. Interação com métricas (informativo, não exige mudança)

`GET /health` continua contabilizado em `http_requests_total{route="/health"}` pelo
`HttpMetricsInterceptor`, incluindo os `503` — intencional: health check falhando deve aparecer na
taxa de erro 5xx. Não adicionar exceção para `/health` no interceptor.

---

## 6. Critérios de aceite

### Dependências e fiação
- [ ] **CA1** — `@nestjs/terminus`, `@nestjs/microservices` e `amqp-connection-manager` constam em
  `dependencies` no `package.json` (ou, se o Plano B da seção 2 foi adotado, apenas
  `@nestjs/terminus`, com a decisão registrada no PR).
- [ ] **CA2** — `HealthModule` injeta o `RabbitmqService` **exportado pelo `EventsModule`**; não
  existe uma segunda instanciação de `RabbitmqService` em `providers` do `HealthModule`.

### Caminho feliz
- [ ] **CA3** — Com Postgres e RabbitMQ no ar, `curl -i http://localhost:3003/health` retorna **200**
  com `"status":"ok"` e os três indicadores (`database`, `rabbitmq`, `rabbitmq-channel`) em
  `"status":"up"`.
- [ ] **CA4** — `GET /health` sem header `Authorization` retorna 200 (não 401).

### Falhas de dependência
- [ ] **CA5** — Com o Postgres da porta 5437 parado, `GET /health` retorna **503**, `database` em
  `error` com `"status":"down"`, e os indicadores de RabbitMQ continuam `up` em `info`.
- [ ] **CA6** — Com o RabbitMQ parado (`docker stop <rabbitmq>`) e o serviço reiniciado em seguida
  (cenário "subiu sem broker"), `GET /health` retorna **503** com **`rabbitmq`** e
  **`rabbitmq-channel`** em `error`.
- [ ] **CA7** — Com o serviço já rodando e conectado, parar o RabbitMQ faz `GET /health` passar de
  200 para **503** sem reiniciar o serviço.
- [ ] **CA8** — Restaurando ambas as dependências, `GET /health` volta a **200**. *(Observação
  esperada: `rabbitmq-channel` pode permanecer `down` até o serviço reconectar — o `RabbitmqService`
  atual não implementa reconexão automática. Se for esse o caso, registrar como known issue no PR;
  reconexão automática é fora do escopo desta spec.)*
- [ ] **CA9** — Com o RabbitMQ fora, `GET /health` responde em menos de **5s** (efeito dos timeouts
  de 1500ms e 3000ms), não ficando pendurado.

### Regressão
- [ ] **CA10** — Não existe mais handler `GET /health` em `app.controller.ts`; `GET /` continua
  respondendo `Hello World!`.
- [ ] **CA11** — `npm run build`, `npm run lint`, `npm test` e a suíte e2e existente continuam verdes.
- [ ] **CA12** — Nenhum arquivo em `src/metrics/`, `src/orders/` ou `src/cart/` foi alterado.
- [ ] **CA13** — Nenhum comportamento de publicação/consumo do `RabbitmqService` foi alterado — a
  spec apenas **lê** o estado do canal.

---

## 7. Validação manual

```bash
# 1. tudo no ar
curl -s http://localhost:3003/health | jq            # status ok, 3 indicadores up

# 2. derrubar só o broker
docker stop <rabbitmq>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3003/health   # 503
curl -s http://localhost:3003/health | jq '.error'                      # rabbitmq* down

# 3. religar broker, derrubar só o banco
docker start <rabbitmq>
docker stop <container-do-postgres-checkout>   # porta 5437
curl -s http://localhost:3003/health | jq '.error'                      # database down

# 4. tudo de volta
docker start <container-do-postgres-checkout>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3003/health   # 200
```

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Conflito de peer deps entre `amqp-connection-manager` e `amqplib` 2.0.1 | Avaliado antes do install; Plano B (só indicador customizado) documentado na seção 2 |
| `MicroserviceHealthIndicator` vazar conexões AMQP a cada chamada | O `pingCheck` fecha o cliente ao fim; validar no management UI do RabbitMQ que o número de conexões não cresce a cada `curl` |
| Health `up` com o serviço sem canal (falha silenciosa da seção 1.1) | Indicador `rabbitmq-channel` obrigatório (RF4, CA6) |
| URL do broker divergente entre health check e `RabbitmqService` | RF2 exige a mesma chave `RABBITMQ_URL` e o mesmo default |
| Esquecer `@Public()` → 401 no `/health` | CA4 |
| `/health` pendurado | Timeouts explícitos em ambos os indicadores de I/O (CA9) |

---

## 9. Dependências e sequência

- **Depende de:** spec [`01 - domain-entities-and-jwt-authentication`](./01%20-%20domain-entities-and-jwt-authentication.md)
  (mecanismo `@Public()`) e [`03 - finalizacao-do-pedido-checkout`](./03%20-%20finalizacao-do-pedido-checkout.md)
  (`EventsModule`/`RabbitmqService`).
- **Relacionada:** `api-gateway/docs/specs/02 - health-check-avancado-com-terminus.md`.
- **Consumida por:** `observability-stack/docs/specs/alerting-rules-prometheus-e-painel-de-alertas.md`.
- **Fora desta spec (candidato a spec futura):** reconexão automática do `RabbitmqService` — hoje,
  perdida a conexão, o serviço não se recupera sozinho (ver CA8).
