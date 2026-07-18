import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { ProxyModule } from '../proxy/proxy.module';
import { PaymentsProxyController } from './payments.controller';

@Module({
  imports: [ProxyModule, PassportModule],
  controllers: [PaymentsProxyController],
})
export class PaymentsModule {}
