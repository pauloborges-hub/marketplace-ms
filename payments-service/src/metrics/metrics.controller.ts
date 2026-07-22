import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { MetricsService } from './metrics.service';

// Rota pública por ausência de qualquer guard neste serviço — o payments-service
// não tem AuthModule/JwtAuthGuard, então nada precisa ser marcado para liberar
// o acesso sem token.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metricsService.getContentType());

    return this.metricsService.getMetrics();
  }
}
