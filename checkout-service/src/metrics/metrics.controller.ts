import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';

// @Public() libera a rota do JwtAuthGuard global (APP_GUARD no AppModule), que
// de outra forma exigiria token e retornaria 401.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get()
  @ApiExcludeEndpoint()
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metricsService.getContentType());

    return this.metricsService.getMetrics();
  }
}
