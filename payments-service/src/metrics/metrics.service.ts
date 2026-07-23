import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import { PaymentStatus } from '../payments/entities/payment.entity';

type HttpLabels = 'method' | 'route' | 'status_code';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  // Registry local — nunca o registry global do prom-client, para que instanciar
  // o módulo mais de uma vez no mesmo processo (ex.: e2e em série) não dispare
  // "A metric with the name ... has already been registered".
  private readonly registry = new Registry();
  private readonly requestsTotal: Counter<HttpLabels>;
  private readonly requestDuration: Histogram<HttpLabels>;
  private readonly paymentsProcessedTotal: Counter<string>;
  private readonly paymentsApprovedTotal: Counter<string>;
  private readonly paymentsRejectedTotal: Counter<'reason'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.requestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP recebidas pelo payments-service',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.requestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP no payments-service, em segundos',
      labelNames: ['method', 'route', 'status_code'],
      // Buckets padrão do prom-client: densos na faixa 5–50ms, adequados a um
      // serviço com acesso direto ao Postgres (sem cauda de proxy/timeout).
      registers: [this.registry],
    });

    this.paymentsProcessedTotal = new Counter({
      name: 'payments_processed_total',
      help: 'Total de pagamentos efetivamente processados (aprovados ou rejeitados)',
      registers: [this.registry],
    });

    this.paymentsApprovedTotal = new Counter({
      name: 'payments_approved_total',
      help: 'Total de pagamentos aprovados pelo gateway',
      registers: [this.registry],
    });

    this.paymentsRejectedTotal = new Counter({
      name: 'payments_rejected_total',
      help: 'Total de pagamentos rejeitados pelo gateway, por motivo',
      labelNames: ['reason'],
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

  recordPaymentProcessed(status: PaymentStatus, rejectionReason?: string | null) {
    this.paymentsProcessedTotal.inc();

    if (status === PaymentStatus.APPROVED) {
      this.paymentsApprovedTotal.inc();
    } else if (status === PaymentStatus.REJECTED) {
      this.paymentsRejectedTotal.inc({ reason: rejectionReason ?? 'unknown' });
    }
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
