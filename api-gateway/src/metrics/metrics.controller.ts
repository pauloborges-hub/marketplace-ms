import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';

import { MetricsService } from './metrics.service';

// Rota pública por ausência de @UseGuards(JwtAuthGuard) — o gateway não tem
// guard de JWT global, então @Public() não teria efeito aqui.
//
// O @SkipThrottle precisa nomear cada bucket: o decorator sem argumentos grava
// a chave THROTTLER:SKIPdefault, mas o AppModule só configura os throttlers
// 'short', 'medium' e 'long', e o guard consulta a chave por nome.
@Controller('metrics')
@SkipThrottle({ short: true, medium: true, long: true })
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiExcludeEndpoint()
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metricsService.getContentType());

    return this.metricsService.getMetrics();
  }
}
