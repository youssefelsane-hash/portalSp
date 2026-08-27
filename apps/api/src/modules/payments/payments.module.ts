import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { TechnicianEarningsModule } from './technician-earnings.module';
import { User } from '../auth/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { PaymentChannelsController } from './payment-channels.controller';
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
import { WebhookRecoveryService } from './webhook-recovery.service';
import { FAWRY_GATEWAY } from './gateways/fawry-gateway.interface';
import { FawryGatewayService } from './gateways/fawry-gateway.service';
import { CashProvider } from './gateways/cash-provider.service';
import { FawryProvider } from './gateways/fawry-provider.service';
import { InstaPayProvider } from './gateways/instapay-provider.service';
import { InstaPayQrService } from './gateways/instapay-qr.service';
import { storageServiceProvider } from '../../common/storage/storage.provider';
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
import { WalletAdjustment } from './entities/wallet-adjustment.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Installment } from '../installments/entities/installment.entity';
import { InstallmentCollectionService } from './installment-collection.service';
import { CrewEarningsService } from './crew-earnings.service';
import { OrderEarningShare } from './entities/order-earning-share.entity';
import { TechnicianDebtService } from './technician-debt.service';
import { TechnicianDebtSettlement } from './entities/technician-debt-settlement.entity';
import { AdminTechnicianDebtController } from './admin-technician-debt.controller';

@Module({
  imports: [
    // كشف مستحقات الفني الشهري (ADR-0038) — موديول مستقل عشان الأدمن يستورده كمان بلا دايرة.
    TechnicianEarningsModule,
    TypeOrmModule.forFeature([
      TechnicianDebtSettlement,
      OrderEarningShare,
      Wallet,
      WalletTransaction,
      WalletAdjustment,
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
      Installment,
    ]),
    CustomersModule,
    TechniciansModule,
    CatalogModule,
    AuditModule,
    SettingsModule,
    PromotionsModule,
  ],
  controllers: [
    AdminTechnicianDebtController,
    WalletController,
    PaymentsController,
    PaymentChannelsController,
    SavedPaymentMethodsController,
    TechnicianPaymentsController,
    AdminPaymentsController,
    AdminWalletController,
    WebhooksController,
  ],
  providers: [
    TechnicianDebtService,
    CrewEarningsService,
    WalletsService,
    PaymentsService,
    PayoutsService,
    SavedPaymentMethodsService,
    WalletProvisioningListener,
    PrepaidOrderSettlementListener,
    WebhookRecoveryService,
    // sweep تحصيل الأقساط المستحقة (migration 0177) — نفس فلسفة OrderAutoCancelService:
    // setInterval بـPostgres مباشرة، مش BullMQ repeatable (راجع technicians/README.md).
    InstallmentCollectionService,
    // بوابة Fawry الأصلية (كود مرجعي فوري) — لسه محقونة مباشرة، FawryProvider بيغلّفها بس
    // (ADR-0013). لو مفيش env vars مُعدّة، isConfigured بيبقى false وبيرفض بوضوح.
    { provide: FAWRY_GATEWAY, useClass: FawryGatewayService },
    // PaymentProvider adapters (ADR-0013) — كل طريقة دفع ليها provider واحد مسجّل في
    // PaymentProviderRegistry، صفر تعديل في payments.service.ts لإضافة طريقة جديدة مستقبلاً.
    PaymobProvider,
    CashProvider,
    WalletProvider,
    InstaPayProvider,
    InstaPayQrService,
    // QR كود InstaPay بيترفع لنفس التخزين المشترك (docs/08 §78-د) — نفس الـprovider اللي
    // branding/catalog/chat بيستخدموه، مش نسخة تانية.
    storageServiceProvider,
    FawryProvider,
    PaymentProviderRegistry,
  ],
  exports: [
    TechnicianDebtService,
    CrewEarningsService,WalletsService, PaymentsService, PayoutsService],
})
export class PaymentsModule {}
