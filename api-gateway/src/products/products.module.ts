import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { ProxyModule } from '../proxy/proxy.module';
import { ProductsController } from './products.controller';

@Module({
  imports: [ProxyModule, PassportModule],
  controllers: [ProductsController],
})
export class ProductsModule {}
