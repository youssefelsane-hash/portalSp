import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { AuditModule } from '../audit/audit.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { GeoModule } from '../geo/geo.module';
import { MatchingModule } from '../matching/matching.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { SupportModule } from '../support/support.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AdminCancellationReasonsController } from './admin-cancellation-reasons.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { AdminRecurringOrdersController } from './admin-recurring-orders.controller';
import { CancellationReasonsController } from './cancellation-reasons.controller';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { OrdersController } from './orders.controller';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { RecurringOrdersController } from './recurring-orders.controller';
import { OrderDisputeService } from './order-dispute.service';
import { OrderQueriesService } from './order-queries.service';
import { OrderTechnicianOpsService } from './order-technician-ops.service';
import { OrderRescheduleService } from './order-reschedule.service';
import { OrdersService } from './orders.service';
import { PostQuoteProviderSelectionService } from './post-quote-provider-selection.service';
import { OrderAutoCancelService } from './order-auto-cancel.service';
import { CrewShortageEscalationService } from './crew-shortage-escalation.service';
import { OrderItemsService } from './order-items.service';
import { InspectionQuoteService } from './inspection-quote.service';
import { AssessmentTriageService } from './assessment-triage.service';
import { QuoteExpiryService } from './quote-expiry.service';
import { OrderInternalNotesService } from './order-internal-notes.service';
import { OrderMediaService } from './order-media.service';
import { OrderCustomerNotice } from './entities/order-customer-notice.entity';
import { PricingFieldImagesService } from './pricing-field-images.service';
import { ProblemImagesService } from './problem-images.service';
import { OrderTeamService } from './order-team.service';
import { OrderTrackingGateway } from './order-tracking.gateway';
import { RecurringOrdersService } from './recurring-orders.service';
import { CancellationReason } from './entities/cancellation-reason.entity';
import { Order } from './entities/order.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderInternalNote } from './entities/order-internal-note.entity';
import { OrderMedia } from './entities/order-media.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { OrderQuote } from './entities/order-quote.entity';
import { BookingMatchPreview } from './entities/booking-match-preview.entity';
import { BookingMatchPreviewService } from './booking-match-preview.service';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { RealtimeSecurityModule } from '../../common/websocket/realtime-security.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderStatusHistory,
      OrderMedia,
      OrderCustomerNotice,
      OrderItem,
      OrderInternalNote,
      OrderTeamMember,
      RecurringOrderTemplate,
      CancellationReason,
      TechnicianOrderCancellation,
      OrderQuote,
      BookingMatchPreview,
    ]),
    CustomersModule,
    CatalogModule,
    GeoModule,
    TechniciansModule,
    PricingModule,
    PromotionsModule,
    SettingsModule,
    MatchingModule,
    PaymentsModule,
    SupportModule,
    AuditModule,
    // ADR-0068 — الـcontroller بيحلّ صلاحيتَي السعر الأدق (زيادة/إعفاء) قبل ما ينادي الخدمة.
    AdminModule,
    BuildingsModule,
    RealtimeSecurityModule,
  ],
  controllers: [
    OrdersController,
    TechnicianOrderExecutionController,
    RecurringOrdersController,
    AdminOrdersController,
    AdminRecurringOrdersController,
    CancellationReasonsController,
    AdminCancellationReasonsController,
  ],
  providers: [
    OrdersService,
    OrderQueriesService,
    OrderRescheduleService,
    OrderDisputeService,
    OrderTechnicianOpsService,
    PostQuoteProviderSelectionService,
    OrderAutoCancelService,
    CrewShortageEscalationService,
    OrderItemsService,
    InspectionQuoteService,
    AssessmentTriageService,
    QuoteExpiryService,
    OrderInternalNotesService,
    OrderMediaService,
    PricingFieldImagesService,
    ProblemImagesService,
    OrderTeamService,
    OrderTrackingGateway,
    RecurringOrdersService,
    AdminOrdersService,
    CancellationReasonsService,
    BookingMatchPreviewService,
    storageServiceProvider,
  ],
  exports: [OrdersService, OrderQueriesService, OrderRescheduleService, OrderDisputeService, OrderTechnicianOpsService],
})
export class OrdersModule {}
