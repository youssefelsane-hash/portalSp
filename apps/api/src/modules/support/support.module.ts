import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { PaymentsModule } from '../payments/payments.module';
import { Order } from '../orders/entities/order.entity';
import { AdminSupportController } from './admin-support.controller';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { Complaint } from './entities/complaint.entity';
import { ComplaintMessage } from './entities/complaint-message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Complaint, ComplaintMessage, Order]),
    CustomersModule,
    TechniciansModule,
    PaymentsModule,
  ],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
