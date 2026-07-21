import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';

import { MetricsService } from './metrics.service';

export const METRICS_ROUTE_PATH = '/metrics';
export const UNMATCHED_ROUTE = 'unmatched';

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: () => void) {
    const startTime = process.hrtime.bigint();

    // Middleware (e não interceptor) porque os guards do Nest rodam antes dos
    // interceptors: um 401 do JwtAuthGuard ou um 429 do CustomThrottlerGuard
    // nunca chegariam a um APP_INTERCEPTOR. 404 de rota inexistente também não.
    res.on('finish', () => {
      // req.route é preenchido pelo router do Express no match do layer, antes
      // dos guards, e guarda o PADRÃO registrado (/users/:id), não a URL
      // resolvida. Rota inexistente nunca atribui req.route -> 'unmatched',
      // evitando cardinalidade ilimitada de séries no Prometheus.
      const matchedRoute = req.route as { path?: string } | undefined;
      const route = matchedRoute?.path ?? UNMATCHED_ROUTE;

      // O próprio /metrics não se contabiliza, senão cada scrape do Prometheus
      // infla suas contagens.
      if (route === METRICS_ROUTE_PATH) {
        return;
      }

      const durationSeconds =
        Number(process.hrtime.bigint() - startTime) / 1_000_000_000;

      this.metricsService.recordHttpRequest(
        req.method,
        route,
        res.statusCode,
        durationSeconds,
      );
    });

    next();
  }
}
