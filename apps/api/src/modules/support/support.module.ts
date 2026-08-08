import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { PaymentsModule } from '../payments/payments.module';
import { Order } from '../orders/entities/order.entity';
import { STORAGE_SERVICE } from '../../common/storage/storage.service';
import { LocalDiskStorageService } from '../../common/storage/local-disk-storage.service';
import { AdminSupportController } from './admin-support.controller';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { Complaint } from './entities/complaint.entity';
import { ComplaintAttachment } from './entities/complaint-attachment.entity';
import { ComplaintMessage } from './entities/complaint-message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Complaint, ComplaintMessage, ComplaintAttachment, Order]),
    CustomersModule,
    TechniciansModule,
    PaymentsModule,
    AuditModule,
  ],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, { provide: STORAGE_SERVICE, useClass: LocalDiskStorageService }],
  exports: [SupportService],
})
export class SupportModule {}
