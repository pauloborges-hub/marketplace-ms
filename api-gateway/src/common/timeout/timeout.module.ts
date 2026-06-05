import { Module } from '@nestjs/common';
import { TimeoutService } from './timeout.service';

@Module({
  providers: [TimeoutService],
})
export class TimeoutModule {}
