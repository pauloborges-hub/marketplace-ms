import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

// Não importa TypeOrmModule: a conexão default registrada com
// TypeOrmModule.forRoot no AppModule é global e o TypeOrmHealthIndicator
// resolve esse DataSource sozinho.
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
