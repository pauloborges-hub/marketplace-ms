import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';

import { MetricsService } from '../metrics.service';

export const METRICS_ROUTE_PATH = '/metrics';
export const UNMATCHED_ROUTE = 'unmatched';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    // Usa o evento `finish` para capturar o status_code final (inclusive os
    // definidos por exception filters), e não um valor provisório.
    res.on('finish', () => {
      // req.route.path guarda o PADRÃO registrado (/orders/:id), não a URL
      // resolvida com valores reais. Sem global prefix nem versioning no
      // main.ts, o padrão já vem completo. Rota não resolvida vira 'unmatched'
      // para não gerar cardinalidade ilimitada de séries no Prometheus.
      const matchedRoute = req.route as { path?: string } | undefined;
      const route = matchedRoute?.path ?? UNMATCHED_ROUTE;

      // O próprio /metrics não se contabiliza, senão cada scrape do Prometheus
      // infla suas contagens.
      if (route === METRICS_ROUTE_PATH) {
        return;
      }

      const durationSeconds =
        Number(process.hrtime.bigint() - start) / 1_000_000_000;

      this.metricsService.recordHttpRequest(
        req.method,
        route,
        res.statusCode,
        durationSeconds,
      );
    });

    return next.handle();
  }
}
