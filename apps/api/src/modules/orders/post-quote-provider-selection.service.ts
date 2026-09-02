import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AuditLogService } from '../audit/audit-log.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { LevelPremiumService } from '../pricing/level-premium.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { CandidateOperationalLoad } from '../technicians/technician-day-capacity.sql';
import { Order, OrderPriceStatus, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';
import { LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR } from './order-provider-lock';

/** كارت مرشّح لاختيار المنفّذ بعد اعتماد عرض السعر — نفس بيانات كارت السوق + السعر النهائي بمستواه. */
export interface PostQuoteProviderCandidate {
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  distance_km: number | null;
  current_level: string;
  is_verified: boolean;
  /** قيمة العرض المعتمد + فرق مستوى الفني ده. ده اللي هيتحصّل بالظبط لو العميل اختاره. */
  final_price_cents: number;
  /** الفرق لوحده — معروض صراحة عشان العميل يشوف سبب اختلاف السعر بين المرشّحين (docs/08 §60.3). */
  level_premium_cents: number;
}

/**
 * **ADR-0066 — اختيار المنفّذ بعد اعتماد عرض السعر.**
 *
 * الحالة `AWAITING_TECHNICIAN_SELECTION` كانت موجودة من ADR-0063 والانتقال ليها شغّال، بس مفيش
 * مسار يخرج منها — الطلب كان بيقف هناك للأبد. الخدمة دي هي المخرج.
 *
 * **مش محرك مطابقة تاني**: القايمة بتيجي من `TechniciansService.listForServiceBooking()` — نفس
 * القايمة اللي العميل بيشوفها قبل الحجز بالظبط (نفس الأهلية، نفس الترتيب، نفس محرك التوافر
 * بالحمل التشغيلي الحقيقي). الفرق الوحيد إن السعر أساسه **قيمة العرض المعتمد**، مش معادلة الخدمة.
 */
@Injectable()
export class PostQuoteProviderSelectionService {
  private readonly logger = new Logger(PostQuoteProviderSelectionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly catalogService: CatalogService,
    private readonly levelPremiumService: LevelPremiumService,
    private readonly assignmentGuard: TechnicianAssignmentGuardService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  async listCandidates(userId: string, orderId: string): Promise<PostQuoteProviderCandidate[]> {
    const order = await this.findSelectableOrderOrThrow(userId, orderId);
    const { items } = await this.techniciansService.listForServiceBooking(
      order.serviceId,
      order.addressId,
      undefined,
      order.scheduledAt,
      false,
      // الشركات مستبعدة هنا عمدًا: العرض اتحدد لشغلانة بفني واحد، ومعامل سعر الشركة بديل عن
      // مضاعف المستوى (ADR-0042) — خلطهم فوق قيمة عرض معتمدة معناها سعرين لنفس الشغلانة.
      false,
      this.orderLoad(order),
    );

    return Promise.all(
      items
        .filter((item) => !item.isCompany)
        .map(async (item) => {
          const multiplier = await this.catalogService.resolveLevelPriceMultiplier(
            order.serviceId,
            item.currentLevel,
            item.pricingTier ?? undefined,
          );
          const premiumCents = multiplier > 1 ? Math.round(order.totalAmountCents * (multiplier - 1)) : 0;
          return {
            technician_id: item.technicianId,
            full_name: item.fullName,
            avatar_url: item.avatarUrl,
            average_rating: item.averageRating,
            total_ratings_count: item.totalRatingsCount,
            completed_orders_count: item.serviceCompletedCount,
            distance_km: item.distanceKm,
            current_level: item.currentLevel,
            is_verified: item.isVerified,
            final_price_cents: order.totalAmountCents + premiumCents,
            level_premium_cents: premiumCents,
          };
        }),
    );
  }

  /**
   * العميل اختار منفّذ. الفني بيتقفل صفه، بيتفحص بنفس بوابة المطابقة، وفرق مستواه بيتضاف **مرة
   * واحدة** — كله جوّه ترانزاكشن واحدة عشان مايبقاش فيه لحظة الطلب فيها متعيّن على فني بسعر
   * غلط أو العكس.
   */
  async selectProvider(userId: string, orderId: string, technicianId: string): Promise<Order> {
    await this.findSelectableOrderOrThrow(userId, orderId);
    const technicianProfile = await this.techniciansService.findByProfileIdOrThrow(technicianId);

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order || order.orderStatus !== OrderStatus.AWAITING_TECHNICIAN_SELECTION) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في مرحلة اختيار المنفّذ', HttpStatus.CONFLICT);
      }
      const technician = await manager
        .createQueryBuilder(TechnicianProfile, 'tp')
        .setLock('pessimistic_write')
        .where('tp.id = :id', { id: technicianProfile.id })
        .getOne();
      if (!technician) {
        throw new ApiException(ErrorCode.ORDR_001, LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR, HttpStatus.CONFLICT);
      }
      try {
        await this.assignmentGuard.assertEligible(manager, technician, order);
      } catch {
        throw new ApiException(ErrorCode.ORDR_001, LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR, HttpStatus.CONFLICT);
      }

      const previousStatus = order.orderStatus;
      const previousTotalCents = order.totalAmountCents;
      const premiumCents = await this.levelPremiumService.applyOnProviderSelection(manager, order, technician);

      if (!canTransition(previousStatus, OrderStatus.SEARCHING_TECHNICIAN)) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في مرحلة اختيار المنفّذ', HttpStatus.CONFLICT);
      }
      order.orderStatus = OrderStatus.SEARCHING_TECHNICIAN;
      order.requestedTechnicianId = technician.id;
      // ADR-0066 §1 — من هنا ورايح، ده منفّذ مقفول: التوزيع مايستبدلوش بصمت (ADR-0065 §1).
      order.providerLockSource = 'post_quote_selection';
      order.priceStatus = OrderPriceStatus.LOCKED;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.SEARCHING_TECHNICIAN,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: `العميل اختار المنفّذ بعد اعتماد عرض السعر — فرق المستوى ${premiumCents} قرش`,
          metadata: {
            technician_id: technician.id,
            level_premium_cents: premiumCents,
            previous_total_cents: previousTotalCents,
            new_total_cents: order.totalAmountCents,
          },
        }),
      );
      return { order, premiumCents, previousStatus, previousTotalCents };
    });

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'order.provider.selected_after_quote',
      entityType: 'order',
      entityId: orderId,
      oldValues: { order_status: result.previousStatus, total_amount_cents: result.previousTotalCents },
      newValues: {
        order_status: OrderStatus.SEARCHING_TECHNICIAN,
        technician_id: technicianId,
        level_premium_cents: result.premiumCents,
        total_amount_cents: result.order.totalAmountCents,
      },
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        result.order.id,
        result.order.orderNumber,
        result.previousStatus,
        OrderStatus.SEARCHING_TECHNICIAN,
        result.order.customerId,
        null,
      ),
    );
    // نقل الطلب لـSEARCHING_TECHNICIAN مابيوزّعوش لوحده: التوزيع كله بيتعلّق على
    // ORDER_CREATED_EVENT (نقطة الدخول الموحّدة، ADR-0018 — OrderDispatchListener →
    // dispatchOrAutoConfirm). من غير البث ده الطلب بيقف في SEARCHING_TECHNICIAN للأبد، وده كان
    // بيحوّل «الوقفة الأبدية» من AWAITING_TECHNICIAN_SELECTION لحالة بعدها بس مش بيحلّها.
    // بعد الـcommit عمدًا (قاعدة المشروع: مفيش حدث قبل نجاح الـtransaction)، وبـemitAsync زي
    // OrdersService.create() بالحرف. الـlistener بيبلع أخطاءه بنفسه فمفيش خطر على رد العميل.
    await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(result.order.id));
    this.logger.log(
      `الطلب ${result.order.orderNumber} اتقفل على منفّذ بعد عرض السعر — فرق المستوى ${result.premiumCents} قرش`,
    );
    return result.order;
  }

  private async findSelectableOrderOrThrow(userId: string, orderId: string): Promise<Order> {
    const customer = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.dataSource
      .getRepository(Order)
      .findOne({ where: { id: orderId, customerId: customer.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    if (order.orderStatus !== OrderStatus.AWAITING_TECHNICIAN_SELECTION) {
      throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في مرحلة اختيار المنفّذ', HttpStatus.CONFLICT);
    }
    return order;
  }

  /** ADR-0064 §3 — الحمل التشغيلي متخزّن على الطلب أصلاً، فالفلترة بتقيس المرشّحين بيه مش بيوم واحد. */
  private orderLoad(order: Order): CandidateOperationalLoad {
    return {
      durationMinutes:
        order.durationMinutes ?? (order.durationHours !== null ? Math.round(order.durationHours * 60) : null),
      estimatedDurationDays: order.estimatedDurationDays,
    };
  }
}
