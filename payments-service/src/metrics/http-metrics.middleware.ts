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

    // Middleware (e não interceptor) porque um interceptor global do NestJS não
    // roda para rotas não-casadas: o 404 de uma rota inexistente vem do fallback
    // do Express e nunca chegaria a um APP_INTERCEPTOR. O middleware, aplicado a
    // '*', enxerga toda requisição — inclusive as que terminam em 404.
    res.on('finish', () => {
      // req.route é preenchido pelo router do Express no match do layer e guarda
      // o PADRÃO registrado (/payments/:orderId), não a URL resolvida com valores
      // reais. Rota inexistente nunca atribui req.route -> 'unmatched', evitando
      // cardinalidade ilimitada de séries no Prometheus.
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
