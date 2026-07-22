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

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.requestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP recebidas pelo products-service',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.requestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP no products-service, em segundos',
      labelNames: ['method', 'route', 'status_code'],
      // Buckets padrão do prom-client: densos na faixa 5–50ms, adequados a um
      // serviço com acesso direto ao Postgres (sem cauda de proxy/timeout).
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
