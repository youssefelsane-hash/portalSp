import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { User } from '../auth/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { PaymentsController } from './payments.controller';
import { SavedPaymentMethodsController } from './saved-payment-methods.controller';
import { TechnicianPaymentsController } from './technician-payments.controller';
import { WalletController } from './wallet.controller';
import { WebhooksController } from './webhooks.controller';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { SavedPaymentMethodsService } from './saved-payment-methods.service';
import { WalletsService } from './wallets.service';
import { WalletProvisioningListener } from './wallet-provisioning.listener';
import { PrepaidOrderSettlementListener } from './prepaid-order-settlement.listener';
import { FAWRY_GATEWAY } from './gateways/fawry-gateway.interface';
import { FawryGatewayService } from './gateways/fawry-gateway.service';
import { CashProvider } from './gateways/cash-provider.service';
import { FawryProvider } from './gateways/fawry-provider.service';
import { InstaPayProvider } from './gateways/instapay-provider.service';
import { PaymentProviderRegistry } from './gateways/payment-provider.registry';
import { PaymobProvider } from './gateways/paymob-provider.service';
import { WalletProvider } from './gateways/wallet-provider.service';
import { Payment } from './entities/payment.entity';
import { Payout } from './entities/payout.entity';
import { PayoutOrderItem } from './entities/payout-order-item.entity';
import { Refund } from './entities/refund.entity';
import { SavedPaymentMethod } from './entities/saved-payment-method.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WebhookEvent } from './entities/webhook-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet,
      WalletTransaction,
      Payment,
      Refund,
      Payout,
      PayoutOrderItem,
      SavedPaymentMethod,
      Order,
      OrderStatusHistory,
      User,
      WebhookEvent,
      TechnicianProfile,
    ]),
    CustomersModule,
    TechniciansModule,
    CatalogModule,
    AuditModule,
    SettingsModule,
    PromotionsModule,
  ],
  controllers: [
    WalletController,
    PaymentsController,
    SavedPaymentMethodsController,
    TechnicianPaymentsController,
    AdminPaymentsController,
    AdminWalletController,
    WebhooksController,
  ],
  providers: [
    WalletsService,
    PaymentsService,
    PayoutsService,
    SavedPaymentMethodsService,
    WalletProvisioningListener,
    PrepaidOrderSettlementListener,
    // بوابة Fawry الأصلية (كود مرجعي فوري) — لسه محقونة مباشرة، FawryProvider بيغلّفها بس
    // (ADR-0013). لو مفيش env vars مُعدّة، isConfigured بيبقى false وبيرفض بوضوح.
    { provide: FAWRY_GATEWAY, useClass: FawryGatewayService },
    // PaymentProvider adapters (ADR-0013) — كل طريقة دفع ليها provider واحد مسجّل في
    // PaymentProviderRegistry، صفر تعديل في payments.service.ts لإضافة طريقة جديدة مستقبلاً.
    PaymobProvider,
    CashProvider,
    WalletProvider,
    InstaPayProvider,
    FawryProvider,
    PaymentProviderRegistry,
  ],
  exports: [WalletsService, PaymentsService, PayoutsService],
})
export class PaymentsModule {}
