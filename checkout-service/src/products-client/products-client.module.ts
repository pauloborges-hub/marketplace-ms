import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductsClientService } from './products-client.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.getOrThrow<string>('PRODUCTS_SERVICE_URL'),
        timeout: 5000,
      }),
    }),
  ],
  providers: [ProductsClientService],
  exports: [ProductsClientService],
})
export class ProductsClientModule {}
