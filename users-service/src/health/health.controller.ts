import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/decorators/public.decorator';

// Rota pública via @Public(): o users-service tem um JwtAuthGuard global
// (APP_GUARD em AppModule), então sem esse decorator o /health exigiria token e
// o api-gateway passaria a ver o serviço como unhealthy.
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // O timeout evita que um Postgres que aceita a conexão TCP mas não
      // responde deixe o /health pendurado e bloqueie o gateway.
      () => this.db.pingCheck('database', { timeout: 1500 }),
    ]);
  }
}
