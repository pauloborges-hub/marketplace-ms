import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartModule } from '../cart/cart.module';
import { EventsModule } from '../events/events.module';
import { CheckoutController } from './checkout.controller';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentResultConsumer } from './payment-result.consumer';

@Module({
  imports: [TypeOrmModule.forFeature([Order]), CartModule, EventsModule],
  controllers: [CheckoutController, OrdersController],
  providers: [OrdersService, PaymentResultConsumer],
})
export class OrdersModule {}
