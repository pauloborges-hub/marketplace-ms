import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { databaseConfig } from './config/database.config';
import { EventsModule } from './events/events.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [TypeOrmModule.forRoot(databaseConfig), EventsModule, MetricsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
