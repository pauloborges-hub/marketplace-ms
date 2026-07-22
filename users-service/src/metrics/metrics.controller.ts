import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

// Rota pública via @Public(): o users-service tem um JwtAuthGuard global
// (APP_GUARD em AppModule), então sem esse decorator o /metrics exigiria token.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get()
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metricsService.getContentType());

    return this.metricsService.getMetrics();
  }
}
