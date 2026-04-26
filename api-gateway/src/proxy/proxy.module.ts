import { Module } from '@nestjs/common';
import { ProxyService } from './service/proxy.service';

@Module({
  imports: [],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
