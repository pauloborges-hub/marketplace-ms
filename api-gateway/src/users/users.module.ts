import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { ProxyModule } from '../proxy/proxy.module';
import { UsersController } from './users.controller';

@Module({
  imports: [ProxyModule, PassportModule],
  controllers: [UsersController],
})
export class UsersModule {}
