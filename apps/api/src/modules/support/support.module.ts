import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { PaymentsModule } from '../payments/payments.module';
import { Order } from '../orders/entities/order.entity';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AdminSupportController } from './admin-support.controller';
import { AdminSupportTicketsController } from './admin-support-tickets.controller';
import { SupportController } from './support.controller';
import { SupportTicketsController } from './support-tickets.controller';
import { SupportService } from './support.service';
import { SupportTicketsService } from './support-tickets.service';
import { Complaint } from './entities/complaint.entity';
import { ComplaintAttachment } from './entities/complaint-attachment.entity';
import { ComplaintMessage } from './entities/complaint-message.entity';
import { SupportTicket } from './entities/support-ticket.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Complaint, ComplaintMessage, ComplaintAttachment, SupportTicket, Order]),
    CustomersModule,
    TechniciansModule,
    PaymentsModule,
    AuditModule,
  ],
  controllers: [SupportController, AdminSupportController, SupportTicketsController, AdminSupportTicketsController],
  providers: [
    SupportService,
    SupportTicketsService,
    storageServiceProvider,
  ],
  exports: [SupportService, SupportTicketsService],
})
export class SupportModule {}
