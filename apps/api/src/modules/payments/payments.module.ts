import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { User } from '../auth/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsController } from './payments.controller';
import { TechnicianPaymentsController } from './technician-payments.controller';
import { WalletController } from './wallet.controller';
import { WebhooksController } from './webhooks.controller';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { WalletsService } from './wallets.service';
import { WalletProvisioningListener } from './wallet-provisioning.listener';
import { PAYMENT_GATEWAY } from './gateways/payment-gateway.interface';
import { PaymobGatewayService } from './gateways/paymob-gateway.service';
import { Payment } from './entities/payment.entity';
import { Payout } from './entities/payout.entity';
import { Refund } from './entities/refund.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WebhookEvent } from './entities/webhook-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, Payment, Refund, Payout, Order, OrderStatusHistory, User, WebhookEvent, TechnicianProfile]),
    CustomersModule,
    TechniciansModule,
    CatalogModule,
    AuditModule,
    SettingsModule,
  ],
  controllers: [WalletController, PaymentsController, TechnicianPaymentsController, AdminPaymentsController, WebhooksController],
  providers: [
    WalletsService,
    PaymentsService,
    PayoutsService,
    WalletProvisioningListener,
    // Paymob هو التطبيق الوحيد دلوقتي لواجهة PaymentGateway — لو مفيش env vars مُعدّة،
    // isConfigured بيبقى false وبيرفض بوضوح (نفس فلسفة DisabledPaymentGateway، مجرد إن
    // PaymobGatewayService نفسها بتتصرف كـ"معطّلة" لما تلاقي نفسها من غير مفاتيح — أبسط من
    // provider شرطي في NestJS DI، وبيدي رسالة خطأ أوضح بتقول بالظبط أي env var ناقص).
    { provide: PAYMENT_GATEWAY, useClass: PaymobGatewayService },
  ],
  exports: [WalletsService, PaymentsService, PayoutsService],
})
export class PaymentsModule {}
