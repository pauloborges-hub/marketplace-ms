import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

type HttpLabels = 'method' | 'route' | 'status_code';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  // Registry local — nunca o registry global do prom-client, para que instanciar
  // o módulo mais de uma vez no mesmo processo (ex.: e2e em série) não dispare
  // "A metric with the name ... has already been registered".
  private readonly registry = new Registry();
  private readonly requestsTotal: Counter<HttpLabels>;
  private readonly requestDuration: Histogram<HttpLabels>;
  private readonly ordersCreatedTotal: Counter<string>;
  private readonly rabbitmqMessagesPublishedTotal: Counter<'queue'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.requestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP recebidas pelo checkout-service',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.requestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP no checkout-service, em segundos',
      labelNames: ['method', 'route', 'status_code'],
      // Buckets padrão do prom-client: densos na faixa 5–50ms, adequados a um
      // serviço com acesso direto ao Postgres (sem cauda de proxy/timeout).
      registers: [this.registry],
    });

    this.ordersCreatedTotal = new Counter({
      name: 'orders_created_total',
      help: 'Total de pedidos criados com sucesso no checkout',
      registers: [this.registry],
    });

    this.rabbitmqMessagesPublishedTotal = new Counter({
      name: 'rabbitmq_messages_published_total',
      help: 'Total de mensagens publicadas com sucesso no broker, por destino lógico',
      labelNames: ['queue'],
      registers: [this.registry],
    });
  }

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ) {
    const labels = { method, route, status_code: String(statusCode) };

    this.requestsTotal.inc(labels);
    this.requestDuration.observe(labels, durationSeconds);
  }

  recordOrderCreated() {
    this.ordersCreatedTotal.inc();
  }

  recordMessagePublished(queue: string) {
    this.rabbitmqMessagesPublishedTotal.inc({ queue });
  }

  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  onModuleDestroy() {
    this.registry.clear();
  }
}
