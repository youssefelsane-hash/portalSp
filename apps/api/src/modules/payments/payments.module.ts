import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsController } from './payments.controller';
import { TechnicianPaymentsController } from './technician-payments.controller';
import { WalletController } from './wallet.controller';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { WalletsService } from './wallets.service';
import { WalletProvisioningListener } from './wallet-provisioning.listener';
import { Payment } from './entities/payment.entity';
import { Payout } from './entities/payout.entity';
import { Refund } from './entities/refund.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, Payment, Refund, Payout, Order, OrderStatusHistory]),
    CustomersModule,
    TechniciansModule,
    CatalogModule,
  ],
  controllers: [WalletController, PaymentsController, TechnicianPaymentsController, AdminPaymentsController],
  providers: [WalletsService, PaymentsService, PayoutsService, WalletProvisioningListener],
  exports: [WalletsService, PaymentsService, PayoutsService],
})
export class PaymentsModule {}
