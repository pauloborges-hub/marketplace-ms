import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

// Não importa TypeOrmModule: a conexão default registrada por
// TypeOrmModule.forRoot no AppModule é global e o TypeOrmHealthIndicator
// resolve o DataSource default sozinho.
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
