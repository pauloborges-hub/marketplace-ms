import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/decorators/public.decorator';

// Rota pública via @Public(): o products-service tem um JwtAuthGuard global
// (APP_GUARD em AppModule) e, sem esse decorator, o /health devolveria 401 —
// o api-gateway avalia só o status HTTP e passaria a marcar o serviço como
// unhealthy.
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
      // pingCheck roda um SELECT 1 no pool já existente. O timeout evita que um
      // Postgres que aceita TCP mas não responde deixe o /health pendurado e
      // bloqueie o gateway.
      () => this.db.pingCheck('database', { timeout: 1500 }),
    ]);
  }
}
