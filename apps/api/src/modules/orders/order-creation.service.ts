import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { BuildingsService } from '../buildings/buildings.service';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { PriceCertaintyMode, PricingModel } from '../catalog/entities/service.entity';
import { assessmentRouteRejection } from './assessment-route-guard';
import { GeoService } from '../geo/geo.service';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompaniesService } from '../technicians/technician-companies.service';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { buildPricingContext } from '../pricing/pricing-context';
import { schedulePrecision } from '../catalog/schedule-precision';
import { initialPriceStatus } from './initial-price-status';
import { estimatedDisplayRange } from '../catalog/estimated-display-range';
import { contractPeriodFromFieldValues } from '../pricing/pricing-templates';
import { CommissionBaseService } from '../pricing/commission-base.service';
import { computeCommissionableBase } from '../pricing/commission-base';
import { CreateOrderDto } from './dto/create-order.dto';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { PreviewOrderResponseDto } from './dto/preview-order-response.dto';
import {
  BookingMode,
  Order,
  OrderCustomerInput,
  OrderPaymentStatus,
  
  OrderSourceChannel,
  OrderStatus,
  OrderType,
} from './entities/order.entity';
import { PricingFieldOption, PricingFieldType } from '../pricing/entities/service-pricing-field.entity';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { nextOccurrence } from './recurring-schedule.util';
import { OrderItem, OrderItemType } from './entities/order-item.entity';
import { assertNoScheduleOverlap } from './order-schedule-interval';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR } from './order-provider-lock';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canAcceptSameDay, isSameDayUrgent, resolveBookingMode } from './booking-mode-resolver';
import { defaultRevisitScheduledAt } from './revisit-schedule';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { BookingMatchPreview } from './entities/booking-match-preview.entity';
import {
  bookingContextHashWithoutProvider,
  bookingFingerprintDiff,
  bookingFingerprintInput,
  bookingMatchContextHash,
  bookingPreviewInputFromCreate,
} from './booking-match-context';

const BOOKING_FINGERPRINT_FIELD_LABELS_AR: Record<string, string> = {
  service_id: 'الخدمة',
  address_id: 'العنوان',
  scheduled_at: 'الموعد',
  scheduled_end_at: 'وقت الانتهاء',
  period_start: 'بداية الفترة',
  period_end: 'نهاية الفترة',
  field_values: 'تفاصيل الخدمة',
  addon_ids: 'الإضافات',
  promo_code: 'كود الخصم',
  building_code: 'كود المبنى',
  requested_technician_id: 'الفني المختار',
  requested_technician_company_id: 'الشركة المختارة',
  schedule_slot_id: 'موعد الفني',
  standard_data_id: 'بيانات الخدمة القياسية',
  requested_units: 'عدد الوحدات',
  warranty_plan_id: 'خطة الضمان',
  pricing_quantity: 'الكمية',
  duration_hours: 'عدد الساعات',
  request_remote_quote: 'التقييم بالصور',
};

interface OptionalWarrantySelection {
  id: string;
  version: number;
  name_ar: string;
  warranty_type: string;
  pricing_model: 'fixed' | 'percentage';
  price_value: number;
  coverage_months: number;
  max_coverage_cents: number | null;
  max_claims: number;
  terms_ar: string | null;
  exclusions_ar: string | null;
}

/**
 * **إنشاء الطلب وتسعيره — الشريحة ٦ (الأخيرة) من تقسيم `OrdersService`** (تدقيق A-1).
 *
 * ## ليه دي أكبر شريحة، وليه ده **مش** عيب فيها
 *
 * إنشاء طلب هو النقطة اللي بيتلاقى فيها كل النظام مرة واحدة: العنوان والمبنى، الخدمة والكتالوج،
 * محرك التسعير وكود الخصم، النطاق الجغرافي، الجدولة، الفني/الشركة المطلوبين، الضمان الاختياري،
 * وصور الفورم الديناميكي. فاعتمادياتها **بطبيعتها** أكتر من أي شريحة تانية.
 *
 * الفرق إن ده بقى **مكتوب صراحة**: الشريحة بتقول محتاجة إيه بالاسم، بدل ما تكون بند وسط ٢٥
 * اعتمادية بتخدم ست فلوهات مختلفة. و`OrdersService` بعد الشريحة دي بقت **واجهة رفيعة بصفر
 * منطق** — كل دالة فيها سطر تفويض واحد.
 *
 * ## اللي جوّاها
 *
 * | | إيه |
 * |---|---|
 * | `create` | الحجز الفعلي — تحقق + تسعير + جدولة + أول صف تاريخ، كلهم في transaction واحدة |
 * | `previewPrice` | نفس حساب السعر **بلا كتابة** — عشان الشاشة تعرض الرقم قبل التأكيد |
 *
 * الاتنين بيشاركوا نفس المساعدات (snapshot إجابات العميل، صور الحقول، الضمان الاختياري)،
 * وده بالظبط سبب وجودهم في شريحة واحدة: لو اتفرقوا، السعر المعروض والسعر المكتوب هيبقى لهم
 * مصدران.
 */
@Injectable()
export class OrderCreationService {
  private readonly logger = new Logger(OrderCreationService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly catalogService: CatalogService,
    private readonly geoService: GeoService,
    private readonly techniciansService: TechniciansService,
    private readonly technicianCompaniesService: TechnicianCompaniesService,
    private readonly scheduleService: TechnicianScheduleService,
    private readonly pricingEngineService: PricingEngineService,
    private readonly promoCodesService: PromoCodesService,
    private readonly buildingsService: BuildingsService,
    private readonly settingsService: SettingsService,
    private readonly commissionBaseService: CommissionBaseService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
    @Optional() private readonly assignmentGuard?: TechnicianAssignmentGuardService,
  ) {}

  private async resolveOptionalWarranty(
    planId: string | undefined,
    serviceId: string,
  ): Promise<OptionalWarrantySelection | null> {
    if (!planId) return null;
    const [plan] = await this.dataSource.query<OptionalWarrantySelection[]>(
      `SELECT wp.id, wp.version, wp.name_ar, wp.warranty_type, wp.pricing_model,
              wp.price_value::float AS price_value, wp.coverage_months,
              wp.max_coverage_cents, wp.max_claims, wp.terms_ar, wp.exclusions_ar
       FROM warranty_plans wp
       JOIN services s ON s.id = $2
       WHERE wp.id = $1 AND wp.is_active = true
         AND wp.slug <> 'system-service-workmanship'
         AND (wp.target_service_id = s.id OR wp.target_category_id = s.category_id)`,
      [planId, serviceId],
    );
    if (!plan) {
      throw new ApiException(ErrorCode.VAL_001, 'خطة الضمان غير متاحة لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }
    return plan;
  }

  private async claimProblemImages(
    manager: EntityManager,
    customerId: string,
    customerUserId: string,
    serviceId: string,
    imageIds: string[] | undefined,
    orderId: string,
  ): Promise<void> {
    const ids = imageIds ?? [];
    if (ids.length === 0) return;

    const uploads = await manager.query<
      {
        id: string;
        customer_id: string;
        service_id: string;
        storage_key: string;
        file_url: string;
        file_size_bytes: number;
        expires_at: Date;
        claimed_order_id: string | null;
      }[]
    >(
      `SELECT id, customer_id, service_id, storage_key, file_url, file_size_bytes,
              expires_at, claimed_order_id
         FROM order_problem_image_uploads
        WHERE id = ANY($1::uuid[])
        FOR UPDATE`,
      [ids],
    );
    const byId = new Map(uploads.map((upload) => [upload.id, upload]));
    for (const id of ids) {
      const upload = byId.get(id);
      if (!upload || upload.customer_id !== customerId || upload.service_id !== serviceId) {
        throw new ApiException(ErrorCode.VAL_001, 'إحدى صور المشكلة لا تخص حسابك أو هذه الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (upload.claimed_order_id && upload.claimed_order_id !== orderId) {
        throw new ApiException(ErrorCode.VAL_001, 'إحدى صور المشكلة مرتبطة بطلب آخر', HttpStatus.BAD_REQUEST);
      }
      if (!upload.claimed_order_id && new Date(upload.expires_at).getTime() <= Date.now()) {
        throw new ApiException(ErrorCode.VAL_001, 'إحدى صور المشكلة انتهت صلاحيتها — ارفعها مرة ثانية', HttpStatus.BAD_REQUEST);
      }

      await manager.query(
        `INSERT INTO order_media
           (order_id, uploaded_by_user_id, media_type, file_url, storage_key,
            file_size_bytes, caption, problem_image_upload_id)
         VALUES ($1, $2, 'problem_photo', $3, $4, $5, 'صورة المشكلة من العميل', $6)
         ON CONFLICT (order_id, problem_image_upload_id)
           WHERE problem_image_upload_id IS NOT NULL DO NOTHING`,
        [orderId, customerUserId, upload.file_url, upload.storage_key, upload.file_size_bytes, id],
      );
      await manager.query(
        `UPDATE order_problem_image_uploads
            SET claimed_order_id = COALESCE(claimed_order_id, $2),
                claimed_at = COALESCE(claimed_at, now())
          WHERE id = $1`,
        [id, orderId],
      );
    }
  }

  private optionalWarrantyPrice(plan: OptionalWarrantySelection | null, serviceTotalCents: number): number {
    if (!plan) return 0;
    return plan.pricing_model === 'fixed'
      ? Math.round(plan.price_value)
      : Math.round((serviceTotalCents * plan.price_value) / 100);
  }

  /**
   * snapshot لإجابات العميل على الفورم الديناميكي (docs/08 §71، طلب مالك صريح).
   *
   * التسميات بتتحل **هنا وقت الحجز** مش وقت العرض: الأدمن ممكن يعيد تسمية الحقل أو يمسحه بعدين،
   * والطلب لازم يفضل يقول اللي العميل شافه واختاره وقتها بالظبط — نفس فلسفة الـsnapshot المتبعة
   * في المشروع كله. وكمان بيخلي العرض في 3 واجهات بصفر استعلامات إضافية.
   *
   * أي فشل هنا **ما ينفعش يكسر إنشاء طلب حقيقي** — بنرجّع null ونكمّل (الطلب أهم من سطر عرض).
   */
  private async buildCustomerInputsSnapshot(
    manager: EntityManager,
    serviceId: string,
    fieldValues: Record<string, string | number | boolean> | undefined,
  ): Promise<OrderCustomerInput[] | null> {
    const entries = Object.entries(fieldValues ?? {});
    if (entries.length === 0) return null;
    try {
      const fields = await manager.query<
        {
          field_key: string;
          field_type: string;
          label_ar: string;
          unit_ar: string | null;
          options: PricingFieldOption[] | null;
          display_order: number;
        }[]
      >(
        `SELECT field_key, field_type, label_ar, unit_ar, options, display_order
           FROM service_pricing_fields
          WHERE service_id = $1 AND deleted_at IS NULL`,
        [serviceId],
      );
      const byKey = new Map(fields.map((f) => [f.field_key, f]));
      const inputs = entries
        .map(([key, rawValue]) => {
          const field = byKey.get(key);
          // قيمة dropdown/multi_select بتيجي كـkey مش نص — بنحلّها للتسمية العربية اللي العميل
          // شافها فعلًا، وإلا الأدمن هيقرا كود زي `type_b` ومش هيفهم منه حاجة.
          const option = field?.options?.find((o) => o.value === String(rawValue));
          const value =
            field?.field_type === PricingFieldType.IMAGE_UPLOAD
              ? `${this.parsePricingFieldImageIds(rawValue).length} صورة مرفوعة`
              : option
                ? option.label_ar
                : typeof rawValue === 'boolean'
                  ? rawValue
                    ? 'نعم'
                    : 'لأ'
                  : String(rawValue);
          return {
            key,
            // حقل اتمسح من الخدمة بعد كده (أو مفيش صف ليه أصلاً) بيتعرض بمفتاحه بدل ما يختفي.
            label: field?.label_ar ?? key,
            value,
            unit: field?.unit_ar ?? null,
            displayOrder: field?.display_order ?? 999,
          };
        })
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(({ key, label, value, unit }) => ({ key, label, value, unit }));
      return inputs.length > 0 ? inputs : null;
    } catch (err) {
      this.logger.warn(`فشل تسجيل مدخلات العميل للطلب (خدمة ${serviceId}) — الطلب بيكمل عادي: ${String(err)}`);
      return null;
    }
  }

  private parsePricingFieldImageIds(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];
  }

  private async validatePricingFieldImages(
    manager: EntityManager,
    customerId: string,
    customerUserId: string,
    serviceId: string,
    fieldValues: Record<string, string | number | boolean> | undefined,
    orderId?: string,
  ): Promise<void> {
    const fields = await manager.query<
      {
        id: string;
        field_key: string;
        label_ar: string;
        is_required: boolean;
        min_files: number;
        max_files: number;
      }[]
    >(
      `SELECT id, field_key, label_ar, is_required, min_files, max_files
         FROM service_pricing_fields
        WHERE service_id = $1
          AND field_type = 'image_upload'
          AND is_active = true
          AND deleted_at IS NULL
        ORDER BY display_order, created_at`,
      [serviceId],
    );

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const field of fields) {
      const ids = this.parsePricingFieldImageIds(fieldValues?.[field.field_key]);
      const minimum = Number(field.min_files ?? (field.is_required ? 1 : 0));
      const maximum = Number(field.max_files ?? 5);
      if (ids.length < minimum) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `حقل "${field.label_ar}" محتاج ${minimum} صورة على الأقل`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (ids.length > maximum) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `حقل "${field.label_ar}" يسمح بحد أقصى ${maximum} صور`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (ids.length === 0) continue;
      if (ids.some((id) => !uuidPattern.test(id))) {
        throw new ApiException(ErrorCode.VAL_001, `صور حقل "${field.label_ar}" غير صالحة`, HttpStatus.BAD_REQUEST);
      }

      const uploads = await manager.query<
        {
          id: string;
          customer_id: string;
          service_id: string;
          field_id: string;
          storage_key: string;
          file_url: string;
          file_size_bytes: number;
          expires_at: Date;
          claimed_order_id: string | null;
        }[]
      >(
        `SELECT id, customer_id, service_id, field_id, storage_key, file_url,
                file_size_bytes, expires_at, claimed_order_id
           FROM pricing_field_uploads
          WHERE id = ANY($1::uuid[])
          ${orderId ? 'FOR UPDATE' : ''}`,
        [ids],
      );
      const byId = new Map(uploads.map((upload) => [upload.id, upload]));
      for (const id of ids) {
        const upload = byId.get(id);
        if (
          !upload ||
          upload.customer_id !== customerId ||
          upload.service_id !== serviceId ||
          upload.field_id !== field.id
        ) {
          throw new ApiException(
            ErrorCode.VAL_001,
            `إحدى صور حقل "${field.label_ar}" لا تخص حسابك أو هذه الخدمة`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (!upload.claimed_order_id && new Date(upload.expires_at).getTime() <= Date.now()) {
          throw new ApiException(
            ErrorCode.VAL_001,
            `إحدى صور حقل "${field.label_ar}" انتهت صلاحيتها — ارفعها مرة ثانية`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      if (!orderId) continue;
      for (const id of ids) {
        const upload = byId.get(id)!;
        await manager.query(
          `INSERT INTO order_media
             (order_id, uploaded_by_user_id, media_type, file_url, storage_key,
              file_size_bytes, caption, pricing_field_upload_id)
           VALUES ($1, $2, 'problem_photo', $3, $4, $5, $6, $7)
           ON CONFLICT (order_id, pricing_field_upload_id)
             WHERE pricing_field_upload_id IS NOT NULL DO NOTHING`,
          [orderId, customerUserId, upload.file_url, upload.storage_key, upload.file_size_bytes, field.label_ar, id],
        );
        await manager.query(
          `UPDATE pricing_field_uploads
              SET claimed_order_id = COALESCE(claimed_order_id, $2),
                  claimed_at = COALESCE(claimed_at, now())
            WHERE id = $1`,
          [id, orderId],
        );
      }
    }
  }

  async create(
    userId: string,
    dto: CreateOrderDto,
    recurringIdentity?: { templateId: string; scheduledFor: Date },
    // Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37). userId هنا يفضل userId العميل
    // نفسه دايمًا (الطلب بيتملك للعميل، مش للموظف) — الفرق الوحيد هو الحقل ده، بيحدد source_channel
    // + created_by_admin_user_id للتدقيق. AdminOrdersController هو المسؤول عن التحقق من الصلاحية
    // (orders.create_for_customer) قبل ما ينادي هنا أصلاً.
    callCenterContext?: { adminUserId: string; meta?: AuditActorMeta },
    // Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — اختياري (recurring-orders
    // مش بيبعته، عنده حماية تانية أصلاً). لو اتبعت، أي نداء تاني بنفس المفتاح لنفس العميل بيرجّع
    // نفس الطلب الأصلي فورًا بدل ما ينشئ نسخة جديدة (double-click/retry شبكة).
    idempotencyKey?: string,
    // القناة اللي الطلب جه منها — بتتحدد من هيدر `X-Client-Channel` اللي كل كلاينت بيبعته
    // (docs/08 §133). الافتراضي `customer_app` بيحافظ على سلوك أي كلاينت قديم مش بيبعت الهيدر.
    sourceChannel: OrderSourceChannel = OrderSourceChannel.CUSTOMER_APP,
  ): Promise<Order> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    // فحص مبكر رخيص قبل أي عمل تاني — الفحص الحاسم فعليًا هو الفهرس الفريد الجزئي على
    // (customer_id, idempotency_key) (migration 0139)، ده بس تحسين أداء لتفادي كل منطق التسعير/
    // التحقق لأي retry واضح بدري.
    if (idempotencyKey) {
      const existing = await this.orders.findOne({ where: { customerId: customerProfile.id, idempotencyKey } });
      if (existing) return existing;
    }

    let selectedMatchPreview: BookingMatchPreview | null = null;
    let selectedMatchContextHash: string | null = null;
    if (dto.match_preview_id) {
      selectedMatchPreview = await this.dataSource.getRepository(BookingMatchPreview).findOne({
        where: { id: dto.match_preview_id, customerId: customerProfile.id },
      });
      if (
        !selectedMatchPreview ||
        selectedMatchPreview.status !== 'active' ||
        selectedMatchPreview.expiresAt.getTime() <= Date.now() ||
        !selectedMatchPreview.technicianId
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'معاينة الفني والسعر انتهت أو استُخدمت — اعمل معاينة جديدة قبل التأكيد',
          HttpStatus.CONFLICT,
        );
      }
      if (
        selectedMatchPreview.serviceId !== dto.service_id ||
        selectedMatchPreview.addressId !== dto.address_id
      ) {
        throw new ApiException(ErrorCode.VAL_001, 'معاينة الحجز لا تخص هذه الخدمة أو العنوان', HttpStatus.CONFLICT);
      }
      if (
        dto.request_remote_quote ||
        dto.original_order_id ||
        dto.repeat_frequency ||
        dto.schedule_slot_id ||
        dto.requested_technician_company_id
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'معاينة الفني لا تُجمع مع تقييم الصور أو إعادة الزيارة أو التكرار أو الشركة أو السلوت',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.requested_technician_id && dto.requested_technician_id !== selectedMatchPreview.technicianId) {
        throw new ApiException(ErrorCode.VAL_001, 'الفني المرسل مختلف عن الفني المثبّت في المعاينة', HttpStatus.CONFLICT);
      }
      dto.requested_technician_id = selectedMatchPreview.technicianId;
      selectedMatchContextHash = bookingMatchContextHash(
        bookingPreviewInputFromCreate(dto),
        selectedMatchPreview.selectionMode,
        selectedMatchPreview.technicianId,
      );
      if (selectedMatchContextHash !== selectedMatchPreview.contextHash) {
        // «معاينة» في الرسالة القديمة كانت بتتقري على إنها معاينة الموقع (زيارة الفني)، وهي
        // أصلاً تذكرة السعر والفني — بلاغ مالك صريح إن الرسالة بتوحي إن الطلب محتاج معاينة
        // وهو مش محتاج. الصياغة الجديدة بتقول اللي حصل فعلاً.
        const changed = selectedMatchPreview.fingerprintInput
          ? bookingFingerprintDiff(
              selectedMatchPreview.fingerprintInput,
              bookingFingerprintInput(bookingPreviewInputFromCreate(dto)),
            )
          : [];
        // أسماء الحقول بس — القيم فيها مدخلات العميل ومالهاش لازمة في اللوج.
        this.logger.warn(
          `تذكرة حجز مرفوضة للعميل ${customerProfile.id}: ${
            changed.length ? `حقول اتغيّرت [${changed.join(', ')}]` : 'تذكرة قديمة قبل migration 0256'
          }`,
        );
        throw new ApiException(
          ErrorCode.VAL_001,
          changed.length
            ? `غيّرت في تفاصيل الحجز بعد ما اخترت الفني (${changed
                .map((field) => BOOKING_FINGERPRINT_FIELD_LABELS_AR[field] ?? field)
                .join('، ')}) — ارجع خطوة واختار الفني والسعر من جديد`
            : 'تفاصيل الحجز اتغيّرت بعد ما اخترت الفني — ارجع خطوة واختار الفني والسعر من جديد',
          HttpStatus.CONFLICT,
        );
      }
    }

    const address = await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);
    const remoteAssessmentRequested = dto.request_remote_quote === true;
    const earlyRejection = assessmentRouteRejection(service, remoteAssessmentRequested ? 'remote' : 'onsite');
    if (earlyRejection) throw new ApiException(ErrorCode.VAL_001, earlyRejection, HttpStatus.BAD_REQUEST);
    if (remoteAssessmentRequested) {
      if (dto.addon_ids?.length || dto.promo_code || dto.building_code || dto.warranty_plan_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الإضافات والخصومات والضمان تتحدد بعد اعتماد سعر التقييم',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const optionalWarranty = await this.resolveOptionalWarranty(dto.warranty_plan_id, service.id);
    this.assertPricingQuantity(service.pricingModel, dto.pricing_quantity);

    // إعادة الزيارة تحت الضمان (docs/08 §7/§108-F) — بَقّة حقيقية اتلقطت: شاشة إعادة الزيارة
    // (order_detail_screen.dart's _requestRevisit) بتبعت original_order_id بس بلا أي field_values
    // — العميل مش بيعيد تحديد نطاق الشغل، هو بس بيطلب إصلاح نفس الشغل اللي اتعمل. من غيرها،
    // catalogService.estimate() تحت كان بيرفض بـ`الحقل "<اسم الحقل، غالبًا سؤال منتهي بـ؟>"
    // مطلوب` — لحقل العميل مش شايفه أصلاً في شاشة إعادة الزيارة، رغم إن السعر الناتج كله هيتشال
    // فورًا تحت (estimatedPriceCents: originalOrder ? 0 : ...، إعادة الزيارة مجانية بالكامل).
    // الحل: نورّث القيم الخام من تقييم التسعير الحقيقي المرتبط بالطلب الأصلي
    // (service_pricing_evaluations، findEvaluationForOrder — نفس المصدر اللي docs/08 §35
    // بيستخدمه للأدمن)، مش من customerInputs (snapshot عرض بالعربي بس، مش قيم خام قابلة لإعادة
    // التقييم).
    // مقصور على formula عمدًا — أي موديل تسعير تاني (fixed/hourly/...) مفيهوش
    // service_pricing_evaluations أصلاً ولا بيطلب field_values في validateAndNormalizeFieldValues()،
    // فاستعلام إضافي هنا كان هيبقى صفر فايدة على أغلب الخدمات.
    if (
      service.pricingModel === PricingModel.FORMULA &&
      dto.original_order_id &&
      (!dto.field_values || Object.keys(dto.field_values).length === 0)
    ) {
      const evaluation = await this.pricingEngineService.findEvaluationForOrder(dto.original_order_id);
      if (evaluation) {
        dto.field_values = evaluation.fieldValues as Record<string, string | number | boolean>;
      }
    }

    // **وضع الحجز بقى مشتق مش مختار (ADR-0048، docs/08 §85)** — `dto.booking_mode` متجاهَل تمامًا
    // هنا. الاشتقاق نفسه محتاج حاجتين لسه مش جاهزين في النقطة دي: اليوم النهائي (بعد حل النطاق
    // المرن/السلوت) وعدد العمال المطلوب (ناتج التسعير) — فبيتم على مرحلتين تحت:
    //   1. `urgent` بعد ما اليوم يتحدد نهائيًا (قبل التسعير — الاستعجال بيدخّل رسوم الطوارئ).
    //   2. `bookingMode` بعد التسعير (الحجم بيتحدد من `required_technicians`، ومابيأثرش على السعر).
    // تفاصيل ليه محورين مستقلين: ADR-0048 §2.

    // قدرة دفع لكل خدمة (ADR-0026، docs/08 §42 Phase A.1) — cash_allowed=false يعني الخدمة دي
    // مينفعش تتقفل بكاش خالص (لازم كارت/InstaPay مقدّم). غياب dto.payment_method يعني كاش ضمنيًا
    // (نفس منطق requestedPrepayMethod تحت بالحرف). إعادة الزيارة تحت الضمان (original_order_id)
    // مستثناة عمدًا — مجانية بالكامل دايمًا (originalOrder ? undefined : ...)، فمفيش كاش فعلي
    // يتحصّل أصلاً عشان يتفحص.
    if (!dto.payment_method && !dto.original_order_id && !service.cashAllowed) {
      throw new ApiException(ErrorCode.VAL_001, 'الدفع كاش مش متاح لهذه الخدمة — لازم تختار بطاقة أو InstaPay أو فوري', HttpStatus.BAD_REQUEST);
    }

    // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — كاش مينفعش يتقسّم "إيداع دلوقتي + باقي
    // بعدين" فعليًا (بيتحصّل يدًا بيد مرة واحدة وقت الاستلام)، فخدمة deposit_required=true لازم
    // دفع مقدّم إلكتروني إجباري بغض النظر عن cash_allowed. نفس استثناء إعادة الزيارة فوق بالحرف
    // (مجانية بالكامل، مفيش إيداع يتحصّل أصلاً).
    if (!dto.payment_method && !dto.original_order_id && service.depositRequired) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'هذه الخدمة تتطلب دفع إيداع مقدّم — لازم تختار بطاقة أو InstaPay أو فوري',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Script 7 Phase 7 كان بيرفض هنا أي `scheduled_at` مع وضع طوارئ، عشان طلب طوارئ بموعد
    // مستقبلي كان بيتأجّل بثه (آلية تأجيل ADR-0009، اتشالت في docs/08 §131) والعميل دافع رسوم
    // استعجال بينتظر بلا استجابة فورية. **الفحص ده بقى بلا معنى بعد ADR-0048**: الطوارئ مابقاش
    // اختيار ممكن يتناقض مع التاريخ — هي **نتيجة** إن التاريخ هو النهارده. "طوارئ بموعد مستقبلي"
    // بقت حالة مستحيلة بالبناء نفسه، مش حالة بترفض. والبث بقى فوري لكل طلب بلا استثناء.

    // ADR-0042 (docs/08 §64.و) — معامل سعر الشركة بيتحمّل هنا مرة واحدة عشان يدخل التسعير تحت.
    //
    // **قيد "لازم وضع اعتماد" اتشال (ADR-0048 §5)**: كان معقول لما العميل هو اللي بيختار الوضع.
    // دلوقتي الوضع محسوب من عدد العمال، فربط تفضيل العميل بيه معناه إن العميل يختار شركة
    // والنظام يرفض اختياره لأن التقدير طلع "فرد واحد". التفضيل بقى مسموح دايمًا — لسه تفضيل مش
    // ضمان، بالظبط زي `requested_technician_id`.
    let requestedCompany: TechnicianCompany | null = null;
    if (dto.requested_technician_company_id) {
      requestedCompany = await this.technicianCompaniesService.findActiveCompanyOrThrow(dto.requested_technician_company_id);
    }

    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    // point-in-polygon حقيقي لو فيه نطاقات في المدينة عندها boundary مرسوم، وإلا fallback
    // لأول نطاق نشط في المدينة (نفس السلوك القديم) — تفاصيل في geo/README.md.
    const [longitude, latitude] = address.location.coordinates;
    const zone = await this.geoService.findZoneForPoint(address.cityId, latitude, longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    // دقة الموعد بقت وضعين بس (ADR-0060 §4): يوم كامل، أو يوم + ساعة وصول. الأربع بوليانات
    // القديمة (ADR-0032) وفروعها اتشالت — تلاتة منهم كانوا بيطلبوا من العميل **مدخلات تسعير**
    // (مدة، فترة بداية/نهاية) وهي مسؤولية محرك التسعير، وده اللي كان بيعرض حقول تاريخ مكررة.
    //
    // إعادة زيارة الضمان طلب إصلاح مجاني تابع لطلب مكتمل، مش حجز جديد — فمابنطلبش من العميل
    // يعيد إدخال حقول الوقت.
    if (!dto.original_order_id && schedulePrecision(service) === 'start_time' && !dto.scheduled_at) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد معاد بداية الخدمة دي', HttpStatus.BAD_REQUEST);
    }
    if (dto.duration_hours) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مدة الخدمة بقت بتتحسب من محرك التسعير مش من العميل — لو محتاجها كمدخل، اعملها حقل في فورم الخدمة',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.scheduled_end_at) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'وقت النهاية مابقاش مدخل حجز — لو الخدمة بفترة (اشتراك/إيجار)، حطها كحقلين تاريخ في فورم الخدمة',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.period_start || dto.period_end) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'فترة التعاقد بقت حقلين تاريخ في فورم الخدمة نفسها مش مدخل منفصل — ابعتهم جوّه field_values',
        HttpStatus.BAD_REQUEST,
      );
    }

    // "إعادة الحجز" — نتأكد إن الـ id فعلاً فني حقيقي بس (404 واضح لو لأ)، مش هل هو متاح/مؤهّل
    // للخدمة دي تحديداً — ده بيتفحص وقت المطابقة نفسها (matching.service.ts)، فالتفضيل ده
    // ببساطة بيتجاهَل بأمان لو مش قابل للتطبيق بدل ما يمنع إنشاء الطلب. **منقولة قبل estimate()**
    // (كانت بعده) عشان نعرف مستوى الفني المطلوب ونطبّق مضاعف سعره الصح من أول تقدير — مبدأ عمل
    // صريح: "السعر النهائي معروف قبل التأكيد، مفيش زيادة مفاجئة بعده" (تفاصيل تحت).
    let requestedTechnicianProfile: TechnicianProfile | null = null;
    if (dto.requested_technician_id) {
      requestedTechnicianProfile = await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id);
    }

    // الجدولة الحقيقية للفني (docs/08 §2-§3، ADR-0002) — كانت `TechnicianScheduleService.bookSlot()`
    // primitive جاهز ومختبر بلا أي caller خالص. العميل اختار سلوت `available` محدد من جدول فني
    // بعينه (GET /technicians/:id/schedule)، ده أقوى من "تفضيل" عادي (requested_technician_id) —
    // الفني نفسه حدد صراحة إنه فاضي في التاريخ/الوقت ده. متبادل استبعادياً مع الطوارئ (استجابة
    // فورية، مش موعد مستقبلي بمعنى مختلف تمامًا) وإعادة الزيارة (بترجع لنفس الفني الأصلي
    // تلقائيًا أصلاً). **قرار موثّق صراحة**: التوزيع لسه فوري وقت إنشاء الطلب مش مؤجّل لوقت
    // السلوت نفسه — نفس السلوك الحالي بالظبط لـ`scheduled_at` العادي (توزيع مؤجل حقيقي محتاج
    // queue جديد بالكامل مش موجود حتى للحقل القديم، فمش هنخترعه بس هنا).
    let scheduleSlot: TechnicianScheduleSlot | null = null;
    if (dto.schedule_slot_id) {
      // الفحص القديم ("سلوت مش متاح لطلبات الطوارئ") اتشال مع ADR-0048 — الطوارئ مابقتش اختيار
      // يتناقض مع السلوت. **العلاقة اتقلبت**: السلوت هو اللي بيلغي الاستعجال (تحت،
      // `urgent = !scheduleSlot && ...`)، لأن سلوت محجوز معناه فني بعينه التزم بوقت محدد —
      // وده عكس بث الطوارئ تمامًا، حتى لو السلوت نفسه في نفس اليوم.
      if (dto.original_order_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة تحت الضمان بترجع لنفس الفني الأصلي تلقائيًا — مينفعش تختار سلوت كمان',
          HttpStatus.BAD_REQUEST,
        );
      }
      scheduleSlot = await this.scheduleService.findAvailableSlotOrThrow(dto.schedule_slot_id);
      if (dto.requested_technician_id && dto.requested_technician_id !== scheduleSlot.technicianId) {
        throw new ApiException(ErrorCode.VAL_001, 'السلوت المختار بتاع فني مختلف عن الفني المطلوب — اختار واحد بس', HttpStatus.BAD_REQUEST);
      }
    }

    // "مرن — اختار نطاق أيام" (docs/08 §32.3، طلب مالك صريح 2026-08-20) — بندوّر يوم بيوم داخل
    // [scheduled_at, scheduled_at_range_end] (الاتنين شاملين) على أقرب يوم فيه فني مؤهّل واحد على
    // الأقل فعليًا، ونستبدل به dto.scheduled_at الحرفي تحت. لو محدش متاح في كل النطاق، بنسيب أول
    // يوم في النطاق كما هو — نفس فلسفة "مفيش إلغاء تلقائي لمجرد مفيش فني دلوقتي"
    // (MatchingRecoveryService.sweep() هتعيد المحاولة تلقائيًا بعد إنشاء الطلب).
    let resolvedScheduledAtIso: string | undefined = dto.scheduled_at;
    if (dto.scheduled_at_range_end) {
      // قدرة "نطاق أيام مرن" لكل خدمة (ADR-0028، docs/08 §42 Phase A.2) — نفس نمط allows_individual/
      // cash_allowed بالحرف. صفر لمس لمنطق حل النطاق تحت — بوابة دخول بس.
      if (!service.allowsDateRangeBooking) {
        throw new ApiException(ErrorCode.VAL_001, 'حجز نطاق أيام مرن مش متاح لهذه الخدمة — لازم تحدد يوم واحد', HttpStatus.BAD_REQUEST);
      }
      if (!dto.scheduled_at) {
        throw new ApiException(ErrorCode.VAL_001, 'نطاق الأيام المرن محتاج تاريخ بداية (scheduled_at)', HttpStatus.BAD_REQUEST);
      }
      if (scheduleSlot) {
        throw new ApiException(ErrorCode.VAL_001, 'مينفعش تحدد نطاق أيام مرن مع سلوت وقت محدد', HttpStatus.BAD_REQUEST);
      }
      const rangeStart = new Date(dto.scheduled_at);
      const rangeEnd = new Date(dto.scheduled_at_range_end);
      const rangeDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000));
      if (rangeDays < 0 || rangeDays > 14) {
        throw new ApiException(ErrorCode.VAL_001, 'نطاق الأيام المرن لازم يكون بين يوم و14 يوم', HttpStatus.BAD_REQUEST);
      }
      for (let offset = 0; offset <= rangeDays; offset += 1) {
        const candidateDay = new Date(rangeStart.getTime() + offset * 24 * 60 * 60 * 1000);
         
        const eligible = await this.techniciansService.hasEligibleTechnicianForDate(service.id, zone.id, address.id, candidateDay);
        if (eligible) {
          resolvedScheduledAtIso = candidateDay.toISOString();
          break;
        }
      }
    }

    // ══ الاشتقاق، المرحلة 1: الاستعجال (ADR-0048 §1/§2) ══
    //
    // اليوم النهائي بقى معروف دلوقتي (بعد حل النطاق المرن فوق)، والاستعجال بيتحدد منه **بس**.
    // لازم يتحسب هنا بالذات — قبل التسعير مباشرة — لأنه مدخل لرسوم الطوارئ.
    //
    // **السلوت المحجوز بيلغي الاستعجال** حتى لو في نفس اليوم: فني بعينه التزم بوقت محدد، وده
    // تعيين مؤكّد مش بث طوارئ. تحويله لطوارئ كان هيلغي التزامه ويبثّه لناس تانية.
    // A recurring occurrence was commercially scheduled when the customer created the
    // plan. Materialising it on the visit day must not turn it into a new same-day
    // emergency or add an emergency fee merely because a worker ran late.
    const urgent = !recurringIdentity
      && !scheduleSlot
      && isSameDayUrgent({ scheduledAt: resolvedScheduledAtIso ? new Date(resolvedScheduledAtIso) : null });
    if (urgent && !canAcceptSameDay(service)) {
      // الأدمن قافل نفس اليوم على الخدمة دي (`allows_emergency = false`). الرفض أوضح من تسجيل
      // الطلب عادي: العميل اختار النهارده وهو متوقّع حد يجي النهارده (ADR-0048 §3).
      throw new ApiException(
        ErrorCode.VAL_001,
        'الخدمة دي مش متاحة لنفس اليوم — اختار يوم تاني',
        HttpStatus.BAD_REQUEST,
      );
    }

    // مضاعف سعر مستوى الفني (docs/08 — "قرار عمل: السعر النهائي معروف قبل التأكيد") — بيتطبّق
    // بس لو الفني معروف صراحة وقت الحجز (اختيار مباشر أو سلوت جدولة)، مش لو العميل سايب المطابقة
    // تختار (technicianLevel=undefined يبقى مضاعف=1 داخل estimate()، زي ما كان بالظبط). سلوت
    // الجدولة بيغلب requested_technician_id لو الاتنين موجودين (نفس أولوية اختيار الفني تحت).
    const scheduleSlotTechnicianProfile = scheduleSlot
      ? await this.techniciansService.findByProfileIdOrThrow(scheduleSlot.technicianId)
      : null;
    const knownTechnicianLevel = scheduleSlotTechnicianProfile?.currentLevel ?? requestedTechnicianProfile?.currentLevel;
    // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — نفس منطق knownTechnicianLevel فوق بالحرف،
    // مصدر مستقل (technician_profiles.pricing_tier) عشان الفصل الكامل عن currentLevel التشغيلي.
    const knownTechnicianPricingTier = scheduleSlotTechnicianProfile?.pricingTier ?? requestedTechnicianProfile?.pricingTier;

    // ADR-0060 §2 — فترة التعاقد مصدرها **حقول الفورم** (اللي قالب «بالشهر» بيزرعها)، مش مدخل
    // منفصل في الطلب. القراءة من نفس المكان اللي المعادلة بتحسب منه بتضمن إن العمود المحفوظ على
    // الطلب والسعر المحسوب مابيتفرقوش أبدًا.
    const period = contractPeriodFromFieldValues(dto.field_values);

    const pricingContext = buildPricingContext({
      scheduledAt: resolvedScheduledAtIso,
      periodStart: period.start,
      periodEnd: period.end,
      serviceFieldValues: dto.field_values,
      zoneId: zone.id,
      isEmergency: urgent,
      technicianLevel: knownTechnicianLevel,
      addonIds: dto.addon_ids,
      recurringMetadata: dto.repeat_frequency ? { frequency: dto.repeat_frequency } : undefined,
    });



    const estimate = await this.catalogService.estimate(
      service.id,
      zone.id,
      knownTechnicianLevel,
      // رسوم الطوارئ بقت بتتطبّق على **كل** طلب نفس اليوم لكل الفئات (ADR-0048، طلب مالك صريح:
      // «أي طلب بيتعامل في نفس اليوم بيتسجل طوارئ… ولكن بزيادة الطوارئ طبعًا»).
      urgent,
      dto.field_values,
      knownTechnicianPricingTier,
      undefined,
      undefined,
      // ADR-0042 — حجز شركة بيتسعّر بمعاملها هي بدل مضاعف المستوى (اللي بيبقى غير معروف أصلاً
      // في حجز الشركة). نفس القيمة اللي العميل شافها في المقارنة قبل ما يختار.
      requestedCompany ? Number(requestedCompany.priceMultiplier) : undefined,
      pricingContext,
    );
    const addons = await this.catalogService.findAddonsByIds(service.id, dto.addon_ids ?? []);
    const addonsTotalCents = addons.reduce((sum, addon) => sum + addon.priceCents, 0);

    // محرك الإنتاجية (docs/06 §3.3-§3.6) — قرار عمل من المالك: القيم المحسوبة هنا بتتسجّل
    // snapshot على الطلب نفسه (مش مجرد معاينة زي POST /services/:id/estimate-duration)، عشان
    // تفضل ظاهرة لفريق العمليات/الفني حتى لو الأدمن غيّر service_standard_data بعدين.
    let durationEstimate: Awaited<ReturnType<CatalogService['estimateDuration']>> | null = null;
    // بَقّة حقيقية اتلقطت (Script 7 Phase 5): الفحص القديم `&&` كان بيسمح بالظبط بالحالة الممنوعة
    // في تعليق DTO نفسه ("الاتنين لازم يتبعتوا مع بعض أو ولا واحد فيهم") — لو العميل بعت واحد بس
    // من standard_data_id/requested_units، الكود كان بيتجاهله بصمت ويحفظ الطلب بـrequiredTechnicians/
    // requiredAssistants=null بلا أي خطأ، فمطابقة المساعدين (assistant-matching.service.ts) كانت
    // بتتخطى تمامًا (`if (!order.requiredAssistants...) return;`) لشغلانة ممكن تحتاج طاقم فعليًا.
    if (Boolean(dto.standard_data_id) !== Boolean(dto.requested_units)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'standard_data_id وrequested_units لازم يتبعتوا مع بعض — مينفعش واحد من غير التاني',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.standard_data_id && dto.requested_units) {
      durationEstimate = await this.catalogService.estimateDuration(service.id, dto.standard_data_id, dto.requested_units);
    }

    // docs/01B — تكامل Price Engine → Booking: مخرجات المعادلة التشغيلية (طاقم/مدة/ملاءمة
    // طوارئ) بتوصل هنا رسميًا. الأولوية لمسار الإنتاجية القياسي (standard_data) لو العميل
    // استخدمه صراحةً — ده المسار المقتبس من العميل؛ مخرجات المعادلة بتملأ الفراغ.
    const formulaCrewTechnicians =
      !durationEstimate && estimate.required_technicians != null ? estimate.required_technicians : null;
    const formulaCrewAssistants =
      !durationEstimate && estimate.required_assistants != null ? estimate.required_assistants : null;
    const formulaDurationDays =
      !durationEstimate && estimate.estimated_duration_days != null ? estimate.estimated_duration_days : null;
    // ADR-0061 §1 — المدة التشغيلية بالدقايق من المعادلة. لازم تتخزن على الطلب لأن كل فحوص
    // الجدولة (`technician-day-capacity.sql.ts`) بتقرا `orders.duration_minutes`؛ من غيرها
    // الشغلانة بتتحسب بالافتراضي (60 دقيقة) مهما كانت ساعاتها الحقيقية = حجز مزدوج.
    const formulaDurationMinutes = estimate.duration_minutes != null ? Math.ceil(estimate.duration_minutes) : null;

    // دقة الوقت (ADR-0031 Slice B) — فحص تعارض حقيقي بدقة ساعة (مش يوم، ADR-0018) لما الفني
    // معروف صراحة سلفًا (تفضيل أو سلوت). لو العميل سايب المطابقة تختار (auto-match)، بوابة الأهلية
    // العادية بمستوى اليوم (technicianAvailabilityCondition) هي اللي بتشتغل وقت التوزيع — فحص
    // ساعي إضافي وقت التوزيع التلقائي نفسه مؤجّل عمدًا (فجوة موثّقة، مش سهو).
    // ADR-0060 §4 — الفحص الساعي فضل زي ما هو، بس المدة بقت **تقدير المنصة** (ناتج المعادلة)
    // بدل رقم بيدخّله العميل. يعني الدقة اتحسّنت مش اتقلّت.
    const preciseScheduleTechnicianId = scheduleSlot?.technicianId ?? requestedTechnicianProfile?.id ?? null;
    const preciseConflictMinutes = formulaDurationMinutes ?? pricingContext.durationMinutes;
    if (
      schedulePrecision(service) === 'start_time' &&
      preciseScheduleTechnicianId &&
      dto.scheduled_at &&
      preciseConflictMinutes !== null &&
      preciseConflictMinutes > 0
    ) {
      const preciseStartsAt = new Date(dto.scheduled_at);
      await assertNoScheduleOverlap(
        this.dataSource,
        {
          technicianId: preciseScheduleTechnicianId,
          startsAt: preciseStartsAt,
          endsAt: new Date(preciseStartsAt.getTime() + preciseConflictMinutes * 60_000),
        },
        (orderNumber) => `الفني ده متعارض مع طلب موجود بالفعل (${orderNumber}) في الفترة دي`,
      );
    }

    if (urgent && estimate.suitable_for_emergency === false) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الخدمة دي مش مناسبة لطلب طوارئ بالمواصفات دي حسب سياسة التسعير — احجزها بموعد عادي',
        HttpStatus.BAD_REQUEST,
      );
    }

    // ══ الاشتقاق، المرحلة 2: الوضع النهائي (ADR-0048 §1) ══
    //
    // عدد العمال بقى معروف دلوقتي (من محرك الإنتاجية القياسي لو العميل استخدمه، وإلا من مخرجات
    // معادلة التسعير). الحجم **مابيأثرش على السعر** — رسوم الطوارئ هي الفرق السعري الوحيد بين
    // الأوضاع — فحسابه بعد التسعير مش بيخلق أي دورة.
    const bookingMode = resolveBookingMode({
      urgent,
      requiredTechnicians: durationEstimate?.assigned_technicians ?? formulaCrewTechnicians,
      requiredAssistants: durationEstimate?.assigned_assistants ?? formulaCrewAssistants,
      service,
    });

    // إعادة زيارة تحت الضمان (docs/08 §7) — لازم: بتاعة نفس العميل، مكتملة فعلاً، لنفس الخدمة
    // ونفس العنوان بالظبط (نفس المشكلة المفروض)، وتحت warranty_expires_at الفعلي لسه. تفضيل
    // (مش ضمان) بيروح لنفس الفني الأصلي — requested_technician_id بتاعه بيتجاهَل ويتحل محله.
    let originalOrder: Order | null = null;
    if (dto.original_order_id) {
      originalOrder = await this.orders.findOne({ where: { id: dto.original_order_id, customerId: customerProfile.id } });
      if (!originalOrder) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب الأصلي غير موجود', HttpStatus.NOT_FOUND);
      }
      if (originalOrder.orderStatus !== OrderStatus.COMPLETED) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب الأصلي لازم يكون مكتمل الأول', HttpStatus.BAD_REQUEST);
      }
      // بَقّة حقيقية اتلقطت (Script 7 Phase 23): إعادة الزيارة نفسها بتاخد warranty_expires_at
      // جديدة بالكامل وقت اكتمالها (نفس مسار settleAndComplete() اللي بيحسبها لأي طلب مكتمل، مفيش
      // استثناء لـorder_type=revisit) — من غير الفحص ده، كانت إعادة زيارة تقدر تبقى original_order_id
      // لإعادة زيارة تانية، وهكذا للأبد: خدمة مجانية بلا نهاية لنفس العميل/العنوان/الخدمة كل ما
      // الضمان يقرب يخلص، بلا أي تعويض للفني بعد الطلب الأصلي. الضمان معناه "نصلح نفس المشكلة تاني
      // لو رجعت"، مش "سلسلة زيارات مجانية بلا حد" — إعادة الزيارة نفسها مينفعش تبقى أصل لإعادة زيارة تانية.
      if (originalOrder.orderType === OrderType.REVISIT) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة تحت الضمان مسموحة مرة واحدة بس لكل طلب أصلي — مينفعش تعمل إعادة زيارة لإعادة زيارة تانية',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (originalOrder.serviceId !== dto.service_id || originalOrder.addressId !== dto.address_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة لازم تكون لنفس الخدمة ونفس العنوان بالظبط',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!originalOrder.warrantyExpiresAt || originalOrder.warrantyExpiresAt.getTime() < Date.now()) {
        throw new ApiException(ErrorCode.VAL_001, 'ضمان الطلب الأصلي انتهى', HttpStatus.BAD_REQUEST);
      }
      if (dto.promo_code || dto.building_code || (dto.addon_ids && dto.addon_ids.length > 0)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'إعادة الزيارة تحت الضمان مجانية بالكامل — مفيش كود خصم ولا إضافات كتالوج معاها',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (originalOrder && optionalWarranty) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'إعادة الزيارة تحت الضمان مجانية ولا تقبل شراء ضمان إضافي',
        HttpStatus.BAD_REQUEST,
      );
    }

    // ADR-0050 §6 (طلب مالك صريح: «يتحط فلتر للعميل أو مكان يرفع فيه الصور بتاعت الحاجة
    // البايظة، والمفروض إحنا نرد عليه بالسعر») — خدمات «كشف ثم عرض سعر» بتنزل بلا سعر، بس
    // ممكن يبقى ليها فورم أسئلة يساعد الإدارة/الفني يسعّروا.
    //
    // **الحقول دي مكانش عليها أي تحقق قبل كده**: `validateAndNormalizeFieldValues` بتتنادى
    // جوّه `pricingEngineService.evaluate()` اللي مابتشتغل غير لخدمات `formula`. النتيجة إن
    // حقل إجباري ممكن يوصل فاضي وقيمة برّه الخيارات تعدّي، والإدارة تسعّر على بيانات ناقصة.
    if (service.pricingModel === PricingModel.INSPECTION_THEN_QUOTE) {
      await this.pricingEngineService.validateFieldValuesOnly(service.id, dto.field_values ?? {});
    }

    const remoteQuoteRequested = dto.request_remote_quote === true;
    // مسار المعاينة في الموقع محتاج فحص برضه — مش بس مسار الصور. غيابه كان بيخلي خدمة
    // سياستها «بالصور فقط» تقبل حجز معاينة وتحصّل رسم الكشف وتبعت فني (docs/08 §124).
    if (!remoteQuoteRequested) {
      const onsiteRejection = assessmentRouteRejection(service, 'onsite');
      if (onsiteRejection) throw new ApiException(ErrorCode.VAL_001, onsiteRejection, HttpStatus.BAD_REQUEST);
    }
    if (remoteQuoteRequested) {
      if (!dto.problem_image_ids?.length) {
        throw new ApiException(ErrorCode.VAL_001, 'ارفع صورة واحدة على الأقل عشان الإدارة تحدد السعر', HttpStatus.BAD_REQUEST);
      }
      const rejection = assessmentRouteRejection(service, 'remote');
      if (rejection) throw new ApiException(ErrorCode.VAL_001, rejection, HttpStatus.BAD_REQUEST);
      if (originalOrder || bookingMode === BookingMode.EMERGENCY || dto.repeat_frequency) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'تسعير الصور متاح للطلب العادي فقط، وليس للطوارئ أو إعادة الزيارة أو الحجز المتكرر',
          HttpStatus.BAD_REQUEST,
        );
      }
      // بند 9 + بند 54 من السكربت — رسم التقييم بيتحصّل **عند الإرسال**، مش بعد مراجعة الإدارة:
      // ده اللي بيغطّي وقت الفرز حتى لو العميل مكمّلش، وبيقلّل الطلبات العبثية.
      //
      // مشروط بوجود رسم فعلاً: الافتراضي `remote_assessment_fee_cents = 0`، وساعتها مفيش حاجة
      // تتحصّل والسلوك بيفضل زي ما هو بالحرف (ممنوع payment_method).
      //
      // الكاش ممنوع أصلاً على مستوى الـDTO (`payment_method` بتقبل card/instapay/fawry_reference
      // بس) — وده مناسب هنا بالضبط: مفيش فني رايح للعميل عشان يستلم منه كاش.
      if (service.remoteAssessmentFeeCents > 0) {
        if (!dto.payment_method) {
          throw new ApiException(
            ErrorCode.VAL_001,
            'لازم تختار طريقة دفع لرسم التقييم قبل إرسال الصور',
            HttpStatus.BAD_REQUEST,
          );
        }
      } else if (dto.payment_method) {
        throw new ApiException(ErrorCode.VAL_001, 'الدفع يتم بعد ما الإدارة تحدد السعر وتوافق عليه', HttpStatus.BAD_REQUEST);
      }
      if (dto.addon_ids?.length || dto.promo_code || dto.building_code || dto.warranty_plan_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الإضافات والخصومات والضمان الإضافي تتحدد بعد اعتماد السعر، مش مع طلب التسعير بالصور',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // "كرّر الحجز ده" (migration 0176) — بوابة الدخول للقالب المتكرر المُنشأ من مسار الحجز
    // العادي. نفس فلسفة كل بوابات القدرة فوق: رفض واضح وقت الطلب بدل حالة نصف جاهزة.
    // التكرار معناه "نفس الحجز ده يتكرر" فمحتاج موعد فعلي محدد + خدمة مفعّل فيها التكرار +
    // مش طوارئ/إعادة زيارة (الاتنين ليهم دلالة زمنية مختلفة تمامًا عن التكرار المجدول).
    let repeatPlanFrequency: RecurringOrderFrequency | null = null;
    if (dto.repeat_frequency) {
      if (optionalWarranty) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الضمان الإضافي يُختار لكل طلب على حدة ولا يمكن تثبيته على حجز متكرر',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.payment_method === 'fawry_reference') {
        throw new ApiException(
          ErrorCode.VAL_001,
          'فوري متاح للحجز الحالي فقط؛ الحجز المتكرر يحتاج بطاقة أو InstaPay',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (originalOrder) {
        throw new ApiException(ErrorCode.VAL_001, 'إعادة الزيارة تحت الضمان مينفعش تتكرر', HttpStatus.BAD_REQUEST);
      }
      if (bookingMode === BookingMode.EMERGENCY) {
        throw new ApiException(ErrorCode.VAL_001, 'طلبات الطوارئ استجابة فورية — مينفعش تتكرر بموعد ثابت', HttpStatus.BAD_REQUEST);
      }
      if (!service.allowsRecurringBooking) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز المتكرر مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (!scheduleSlot && !resolvedScheduledAtIso) {
        throw new ApiException(ErrorCode.VAL_001, 'التكرار محتاج موعد محدد — حدد يوم التنفيذ الأول', HttpStatus.BAD_REQUEST);
      }
      repeatPlanFrequency = dto.repeat_frequency as RecurringOrderFrequency;
    }

    // شروط الدفع بعد الخدمة (migration 0177) — إجبارية من الباك-إند: طلب غير مدفوع مقدّمًا على
    // خدمة عليها سياسة required لازم يحمل قبول النسخة الحالية، وإلا رفض واضح. الطلبات المدفوعة
    // مقدمًا (كارت/InstaPay) وإعادة الزيارة المجانية مستثناة — الشروط دي عن "الدفع لاحقًا".
    let postpaidPolicyVersionIds: string[] = [];
    if (!dto.payment_method && !originalOrder) {
      const required = await this.dataSource.query<{ id: string; title_ar: string }[]>(
        `SELECT v.id, p.title_ar
         FROM payment_policies p
         JOIN LATERAL (
           SELECT id, version FROM payment_policy_versions
           WHERE policy_id = p.id ORDER BY version DESC LIMIT 1
         ) v ON true
         WHERE p.is_active = true AND p.is_required = true AND p.applies_to = 'postpaid_service'
           AND (p.target_service_id IS NULL OR p.target_service_id = $1)
           AND (p.target_category_id IS NULL OR p.target_category_id = $2)
         ORDER BY p.target_service_id NULLS LAST`,
        [service.id, service.categoryId],
      );
      const acceptedSet = new Set(dto.accepted_policy_version_ids ?? []);
      const missing = required.filter((r) => !acceptedSet.has(r.id));
      if (missing.length > 0) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `لازم توافق على شروط الدفع: ${missing.map((m) => m.title_ar).join('، ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      postpaidPolicyVersionIds = required.map((r) => r.id);
    }

    // نظام العمائر (docs/08 §13، ADR-0003) — متبادل استبعادياً مع promo_code (مش الاتنين مع
    // بعض، القرار الكامل في ADR-0003). الحل بيتم قبل الـ transaction (مجرد قراءة، مفيش كتابة
    // زي promo_code اللي محتاج order.id يتسجّل في promo_code_usages).
    if (dto.promo_code && dto.building_code) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تستخدم كود خصم وكود عمارة مع بعض', HttpStatus.BAD_REQUEST);
    }
    const building = dto.building_code ? await this.buildingsService.findActiveByCodeOrThrow(dto.building_code) : null;

    // لازم يتحسب قبل الـ transaction (مش جواها بعد ما الطلب الحالي يتحفظ) — وإلا COUNT(*)
    // هيشوف الطلب الحالي نفسه (نفس الـtransaction) ويحسبه غلط كإنه "مش أول طلب".
    const isNewCustomer = dto.promo_code ? await this.customerProfiles.isNewCustomer(customerProfile.id) : false;

    // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — إعادة زيارة مجانية بالكامل (originalOrder) دايمًا
    // بتتوزّع فورًا بغض النظر عن dto.payment_method (مفيش حاجة تتدفع أصلاً)، ونفس المنطق لو
    // إجمالي الطلب صفر لأي سبب تاني (خصم كامل مثلاً) — دفع كارت/InstaPay بمبلغ صفر مالوش معنى.
    // requiresPrepay النهائية بتتحدد بعد ما totalAmountCents يتحسب فعليًا جوّه الـtransaction تحت.
    // طلب التقييم بالصور بياخد prepay **لرسم التقييم بس** لما الخدمة محددة له رسم (بند 9) —
    // غير كده بيفضل بلا دفع مقدّم زي ما كان.
    const requestedPrepayMethod =
      originalOrder || (remoteQuoteRequested && service.remoteAssessmentFeeCents <= 0)
        ? undefined
        : dto.payment_method;

    // Earnings Engine V2 is an explicit cutover for new orders only. The fixed amount is copied
    // onto the order now, so later catalog edits can never rewrite historical money.
    const earningsV2Enabled = await this.settingsService.getBoolean('earnings.v2_cutover_enabled', false);
    const settlementPolicyVersion: 1 | 2 = earningsV2Enabled ? 2 : 1;
    const platformCommissionCentsSnapshot =
      settlementPolicyVersion === 2 ? (originalOrder ? 0 : service.platformCommissionCents) : null;
    if (settlementPolicyVersion === 2 && platformCommissionCentsSnapshot == null) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الخدمة غير جاهزة للتسوية الجديدة: حدد عمولة المنصة الثابتة أولاً',
        HttpStatus.CONFLICT,
      );
    }

    const remoteAssessmentFeeCents = remoteQuoteRequested ? service.remoteAssessmentFeeCents : 0;
    const initialOrderTotalCents = originalOrder
      ? 0
      : remoteQuoteRequested
        ? remoteAssessmentFeeCents
      : estimate.estimated_total_cents +
        estimate.inspection_fee_cents +
        estimate.emergency_surcharge_cents +
        addonsTotalCents;
    if (
      settlementPolicyVersion === 2 &&
      initialOrderTotalCents > 0 &&
      Number(platformCommissionCentsSnapshot) > initialOrderTotalCents
    ) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'عمولة المنصة الثابتة أكبر من إجمالي الطلب؛ راجع إعداد الخدمة قبل الحجز',
        HttpStatus.CONFLICT,
      );
    }

    let createdOrder: Order;
    try {
      createdOrder = await this.dataSource.transaction(async (manager) => {
      const lockedMatchPreview = selectedMatchPreview
        ? await manager
            .createQueryBuilder(BookingMatchPreview, 'preview')
            .setLock('pessimistic_write')
            .where('preview.id = :id AND preview.customerId = :customerId', {
              id: selectedMatchPreview.id,
              customerId: customerProfile.id,
            })
            .getOne()
        : null;
      if (
        selectedMatchPreview &&
        (!lockedMatchPreview ||
          lockedMatchPreview.status !== 'active' ||
          lockedMatchPreview.expiresAt.getTime() <= Date.now() ||
          lockedMatchPreview.contextHash !== selectedMatchContextHash)
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'معاينة الفني والسعر لم تعد صالحة — اعمل معاينة جديدة',
          HttpStatus.CONFLICT,
        );
      }
      const [{ next_human_readable_number: orderNumber }] = await manager.query<
        { next_human_readable_number: string }[]
      >("SELECT next_human_readable_number('ORD')");

      const now = new Date();
      // طلب الضمان بيتعرض على الفني الأصلي فورًا من خلال revisit pin، لكن التنفيذ نفسه مش
      // طوارئ لحظية. السيرفر هو مصدر الحقيقة للموعد حتى لو عميل قديم ما بعتش scheduled_at.
      const revisitScheduledAt = originalOrder ? defaultRevisitScheduledAt(now) : null;
      const order = manager.create(Order, {
        orderNumber,
        customerId: customerProfile.id,
        serviceId: service.id,
        addressId: address.id,
        serviceZoneId: zone.id,
        // bookingMode=emergency بيفرض orderType=EMERGENCY دايماً (مهما اتبعت dto.order_type)،
        // وإعادة الزيارة بتفرض orderType=REVISIT بنفس المنطق — الاتنين مصدر الحقيقة الوحيد هنا.
        orderType: originalOrder
          ? OrderType.REVISIT
          : bookingMode === BookingMode.EMERGENCY
            ? OrderType.EMERGENCY
            : (dto.order_type ?? OrderType.STANDARD),
        bookingMode,
        requestedTechnicianCompanyId: dto.requested_technician_company_id ?? null,
        selectedMatchPreviewId: lockedMatchPreview?.id ?? null,
        // ADR-0066 §1 — مصدر القفل مسمّى، مش مستنتَج من عمود تاني.
        providerLockSource: lockedMatchPreview ? 'match_preview' : null,
        // ADR-0065 §4 — بصمة الشغلانة بلا الفني. بتتخزّن بس لما يبقى فيه قفل منفّذ فعلي، لأنها
        // مالهاش معنى غير في إعادة اختيار المنفّذ.
        bookingContextHash: lockedMatchPreview ? bookingContextHashWithoutProvider(bookingPreviewInputFromCreate(dto)) : null,
        orderStatus: remoteQuoteRequested ? OrderStatus.AWAITING_ADMIN_QUOTE : OrderStatus.SEARCHING_TECHNICIAN,
        // ADR-0060 §3 — المدة بقت ناتج محسوب مش مدخل عميل. العمودين بيتسجّلوا من السياق لما
        // تكون معروفة، بلا أي فرع على «وضع» الخدمة.
        // ناتج المعادلة أولاً (ADR-0061 §1)، وبعدين السياق (مدة مشتقة من مدخلات نظامية).
        durationMinutes: formulaDurationMinutes ?? pricingContext.durationMinutes,
        durationHours:
          pricingContext.durationHours !== null && Number.isInteger(pricingContext.durationHours)
            ? pricingContext.durationHours
            : null,
        problemDescription: dto.problem_description ?? null,
        customerNotes: dto.customer_notes ?? null,
        // docs/08 §71 (طلب مالك) — إجابات الفورم الديناميكي كانت بتتخزن في
        // service_pricing_evaluations لخدمات formula بس، فأي خدمة تانية إجابات العميل كانت
        // بتتبخّر بعد حساب السعر. بتتسجّل هنا كـsnapshot بتسميات عربية محلولة للعرض في كل واجهة.
        customerInputs: await this.buildCustomerInputsSnapshot(manager, service.id, dto.field_values),
        // سلوت الجدولة (لو اتحجز) بيحدد الموعد المطلوب فعليًا — أدق من resolvedScheduledAtIso
        // (تاريخ/وقت السلوت نفسه اللي الفني أعلن عنه، UTC مباشرة زي باقي أوقات المشروع).
        // resolvedScheduledAtIso = dto.scheduled_at الحر، أو أقرب يوم متاح فعليًا داخل النطاق
        // المرن لو dto.scheduled_at_range_end اتبعت (docs/08 §32.3).
        scheduledAt: revisitScheduledAt
          ? revisitScheduledAt
          : scheduleSlot
            ? new Date(`${scheduleSlot.slotDate}T${scheduleSlot.startTime}Z`)
            : resolvedScheduledAtIso
              ? new Date(resolvedScheduledAtIso)
              : null,
        // ADR-0060 §4 — وضع «بداية ونهاية» اتشال؛ `scheduled_end_at` مابقاش مدخل حجز (اتفحص فوق).
        // العمود بيفضل للطلبات التاريخية ولإعادة الجدولة اللي بتحسبه من المدة.
        scheduledEndAt: null,
        // ADR-0050 §4 — بتتحفظ زي ما وصلت من السياق (اللي فحصها بالفعل)، مش من الـdto الخام.
        pricingPeriodStart: pricingContext.periodStart,
        pricingPeriodEnd: pricingContext.periodEnd,
        projectId: dto.project_id ?? null,
        milestoneId: dto.milestone_id ?? null,
        recurringTemplateId: recurringIdentity?.templateId ?? null,
        recurringOccurrenceAt: recurringIdentity?.scheduledFor ?? null,
        // إعادة الزيارة بتفضّل نفس الفني الأصلي دايماً، وسلوت الجدولة (لو اتحجز) بيحدد فني
        // السلوت نفسه — requested_technician_id بتاع الـ dto بيتجاهَل هنا عمداً في الحالتين.
        requestedTechnicianId: originalOrder
          ? originalOrder.technicianId
          : scheduleSlot
            ? scheduleSlot.technicianId
            : (dto.requested_technician_id ?? null),
        // ADR-0051 (docs/08 §96) — إعادة الزيارة مسؤولية مش تفضيل: الفني اللي شغله رجع عليه هو
        // اللي يصلّحه. requestedTechnicianId فوق تفضيل بيتجاهَل بأمان لو مش متاح؛ العمود ده
        // التزام حصري بلا fallback. بيتحط بس لو الطلب الأصلي كان له فني فعلاً.
        revisitPinnedTechnicianId: originalOrder?.technicianId ?? null,
        revisitPinnedAt: originalOrder?.technicianId ? now : null,
        parentOrderId: originalOrder ? originalOrder.id : null,
        buildingId: building ? building.id : null,
        warrantyPlanId: optionalWarranty?.id ?? null,
        warrantyPriceCents: 0,
        warrantyPlanSnapshot: optionalWarranty ? { ...optionalWarranty } : null,
        // إعادة زيارة تحت الضمان = مجانية بالكامل (docs/08 §7) — مفيش سعر تقديري، مفيش إضافات
        // كتالوج، مفيش كود خصم؛ الطلب ده لنفس المشكلة الأصلية بس مش فرصة شراء إضافية.
        estimatedPriceCents: originalOrder || remoteQuoteRequested ? 0 : estimate.estimated_total_cents,
        initialQuoteSource: remoteQuoteRequested ? 'admin_remote' : null,
        priceStatus: initialPriceStatus({
          hasLockedMatchPreview: Boolean(lockedMatchPreview),
          remoteQuoteRequested,
          priceCertaintyMode: service.priceCertaintyMode,
        }),
        priceCertaintyModeSnapshot: service.priceCertaintyMode,
        assessmentType:
          service.priceCertaintyMode === PriceCertaintyMode.ASSESSMENT_REQUIRED
            ? remoteQuoteRequested
              ? 'remote'
              : 'onsite'
            : null,
        remoteAssessmentFeeCents,
        assessmentFeeRefundableAfterVisitSnapshot: service.assessmentFeeRefundableAfterVisit,
        assessmentFeeCreditModeSnapshot: service.assessmentFeeCreditMode,
        assessmentFeeCreditBpsSnapshot: service.assessmentFeeCreditBps,
        assessmentFeeCreditCents: 0,
        displayPriceMinCentsSnapshot: service.displayPriceMinCents,
        displayPriceMaxCentsSnapshot: service.displayPriceMaxCents,
        onsiteAssessorExecutesWorkSnapshot: service.onsiteAssessorExecutesWork,
        inspectionFeeCents: originalOrder || remoteQuoteRequested ? 0 : estimate.inspection_fee_cents,
        // رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — orders.surge_amount_cents كان عمود راكد،
        // بيتفعّل هنا. صفر لأي طلب مش طوارئ أو إعادة زيارة (مجانية بالكامل أصلاً).
        surgeAmountCents: originalOrder || remoteQuoteRequested ? 0 : estimate.emergency_surcharge_cents,
        totalAmountCents: originalOrder
          ? 0
          : remoteQuoteRequested
            ? remoteAssessmentFeeCents
          : estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents + addonsTotalCents,
        settlementPolicyVersion,
        platformCommissionCentsSnapshot,
        // لسه UNPAID عمداً حتى لو صفر جنيه — لازم يعدّي بنفس دورة الدفع العادية (collectCash/
        // payWithWallet → settleAndComplete) عشان الطلب يتقفل صح ويوصل COMPLETED، مش يعلق في
        // work_completed للأبد. doubleEntry بمحفظة اتحصّن ضد مبلغ صفر تحديداً لأجل الحالة دي.
        paymentStatus: OrderPaymentStatus.UNPAID,
        placedAt: now,
        // **بَقّة بيانات حقيقية (docs/08 §133)**: القيمة كانت مثبّتة على `customer_app` لأي طلب
        // مش مركز اتصال — يعني **كل طلب جاي من الويب كان بيتسجّل إنه من تطبيق الموبايل**،
        // والـenum فيه `web` محدش بيستخدمه. أي تقرير «الطلبات جاية منين» كان بيكدب.
        sourceChannel: callCenterContext ? OrderSourceChannel.CALL_CENTER : sourceChannel,
        createdByAdminUserId: callCenterContext?.adminUserId ?? null,
        // محرك الإنتاجية (docs/06 §3.3-§3.6) — راجع تعليق durationEstimate فوق.
        standardDataId: durationEstimate ? dto.standard_data_id! : null,
        requiredTechnicians: originalOrder ? 1 : (durationEstimate?.assigned_technicians ?? formulaCrewTechnicians),
        requiredAssistants: originalOrder ? 0 : (durationEstimate?.assigned_assistants ?? formulaCrewAssistants),
        estimatedDurationDays: durationEstimate?.estimated_days ?? formulaDurationDays,
        assistantDailyWageCentsSnapshot: originalOrder ? null : (durationEstimate?.assistant_daily_wage_cents ?? null),
        // محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — راجع تعليق العمود.
        requestedUnits: durationEstimate ? String(dto.requested_units) : null,
        // ADR-0060 §3 — مفيش طريقة حساب بتاخد كمية من العميل تاني. العمود بيفضل للطلبات
        // التاريخية والتقارير، وبيتكتب null لأي طلب جديد.
        pricingQuantity: null,
        idempotencyKey: idempotencyKey ?? null,
      });
      await manager.save(order);

      // إعادة الزيارة ترث صور الطلب الأصلي ولا تطلب رفعًا جديدًا من العميل.
      if (!originalOrder) {
        await this.validatePricingFieldImages(manager, customerProfile.id, userId, service.id, dto.field_values, order.id);
      }
      await this.claimProblemImages(manager, customerProfile.id, userId, service.id, dto.problem_image_ids, order.id);

      // حجز السلوت ذرّي جوّه نفس الـtransaction بتاعة إنشاء الطلب — لو حد تاني حجزه في نفس
      // اللحظة (سباق حقيقي بين طلبين)، الطلب كله بيترول باك مش يتعمل بلا سلوت فعلي بيشاور عليه.
      if (scheduleSlot) {
        const booked = await this.scheduleService.bookSlot(scheduleSlot.id, order.id, manager);
        if (!booked) {
          throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من عميل تاني للتو — اختار سلوت تاني', HttpStatus.CONFLICT);
        }
      }

      // إضافات الكتالوج اللي العميل اختارها بنفسه وقت الحجز — is_customer_approved=true فوراً
      // (مختلف عن مسار awaiting_quote_approval في order-items.service.ts اللي الفني بيقترحه
      // أثناء الشغل ومحتاج موافقة لاحقة).
      if (addons.length > 0) {
        await manager.save(
          addons.map((addon) =>
            manager.create(OrderItem, {
              orderId: order.id,
              itemType: OrderItemType.ADDON,
              referenceId: addon.id,
              nameAr: addon.nameAr,
              quantity: '1',
              unitPriceCents: addon.priceCents,
              totalPriceCents: addon.priceCents,
              isCustomerApproved: true,
              approvedAt: now,
              addedByUserId: userId,
            }),
          ),
        );
      }

      // كود الخصم لازم يتحقق ويتسجّل جوّه نفس الـ transaction دي — order.id لازم يكون موجود
      // الأول (order_id NOT NULL في promo_code_usages)، والقفل الذرّي على صف الكود بيحمي من
      // سباق طلبين بيستخدموا نفس الكود في نفس اللحظة يتجاوزوا الحد الأقصى/الميزانية سوا.
      if (dto.promo_code) {
        const { promoCode, discountCents } = await this.promoCodesService.validateAndApply(
          manager,
          dto.promo_code,
          userId,
          order.id,
          {
            serviceId: service.id,
            zoneId: zone.id,
            totalBeforeDiscountCents: order.totalAmountCents,
            inspectionFeeCents: order.inspectionFeeCents,
            isNewCustomer,
          },
        );
        order.promoCodeId = promoCode.id;
        order.discountAmountCents = discountCents;
        order.totalAmountCents -= discountCents;
        await manager.save(order);
      }

      // خصم العمارة (docs/08 §13، ADR-0003) — نسبة مئوية على الإجمالي قبل الخصم، مفيش جدول
      // usage/حدود زي promo_codes (مفيش حد استخدام شهري بالمعنى ده، بس تتبّع عدد الطلبات
      // للمقارنة بـminimum_monthly_orders من واجهة الأدمن، تفصيل منفصل تمامًا عن الخصم نفسه).
      if (building) {
        const discountCents = Math.round((order.totalAmountCents * Number(building.discountPercentage)) / 100);
        order.discountAmountCents = discountCents;
        order.totalAmountCents -= discountCents;
        await manager.save(order);
      }

      // الضمان الإضافي بيتسعّر بعد خصم الخدمة ثم يُضاف كسطر مستقل. الخطة نفسها اتقرأت من
      // الباك-إند واتحفظت snapshot، لذلك العميل لا يقدر يرسل سعرًا ولا يتأثر الطلب بتعديل لاحق.
      if (optionalWarranty) {
        order.warrantyPriceCents = this.optionalWarrantyPrice(optionalWarranty, order.totalAmountCents);
        order.totalAmountCents += order.warrantyPriceCents;
        await manager.save(order);
      }

      if (lockedMatchPreview) {
        // **ADR-0065 §5** — الفني اتفحص وقت المعاينة، والمعاينة ليها عمر. بين اللحظتين ممكن يكون
        // بقى مشغول أو اتحجب أو خرج من المنطقة. الفحص هنا بيحصل **جوّه نفس الترانزاكشن** وبعد
        // ما صف الفني نفسه يتقفل، فقبول متزامن لطلب تاني مايعديش من تحت إيدينا.
        //
        // البوابة هي **نفس** `assertEligible()` اللي التعيين الإداري القسري وقبول الفني بيستخدموها
        // — مش نسخة تانية من الشروط. الرمي هنا بيرجّع الترانزاكشن كلها: **مفيش طلب بيتعمل**،
        // ومفيش سعر بيتغيّر، والعميل بياخد رسالة صريحة يعمل معاينة جديدة.
        if (this.assignmentGuard && lockedMatchPreview.technicianId) {
          const lockedTechnician = await manager
            .createQueryBuilder(TechnicianProfile, 'tp')
            .setLock('pessimistic_write')
            .where('tp.id = :id', { id: lockedMatchPreview.technicianId })
            .getOne();
          if (!lockedTechnician) {
            throw new ApiException(
              ErrorCode.ORDR_001,
              LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR,
              HttpStatus.CONFLICT,
            );
          }
          try {
            await this.assignmentGuard.assertEligible(manager, lockedTechnician, order);
          } catch (guardError) {
            if (process.env.DEBUG_PROVIDER_LOCK) {
              // eslint-disable-next-line no-console
              console.log('[DEBUG provider-lock]', guardError instanceof Error ? guardError.message : guardError);
            }
            // سبب الرفض التفصيلي (مشغول/محجوب/مش مؤهّل) معلومة تشغيلية داخلية — العميل محتاج
            // يعرف حاجة واحدة: الفني ده مابقاش متاح، والخطوة الجاية معاينة جديدة.
            throw new ApiException(
              ErrorCode.ORDR_001,
              LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR,
              HttpStatus.CONFLICT,
            );
          }
        }
        if (order.totalAmountCents !== lockedMatchPreview.finalPriceCents) {
          throw new ApiException(
            ErrorCode.VAL_001,
            'السعر تغيّر منذ المعاينة — لن نؤكد الطلب قبل عرض السعر الجديد عليك',
            HttpStatus.CONFLICT,
          );
        }
        lockedMatchPreview.status = 'consumed';
        lockedMatchPreview.consumedAt = new Date();
        lockedMatchPreview.orderId = order.id;
        await manager.save(lockedMatchPreview);
      }

      // V2 settles a fixed platform amount exactly once. Promotions/building discounts are applied
      // after the initial estimate, so validate the final payable total as well. Failing inside the
      // transaction rolls back the order and any promo usage instead of creating an impossible
      // settlement that would only fail after the work is complete.
      if (
        settlementPolicyVersion === 2 &&
        !remoteQuoteRequested &&
        Number(platformCommissionCentsSnapshot) > order.totalAmountCents
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الإجمالي بعد الخصم أقل من عمولة المنصة الثابتة؛ راجع إعداد الخدمة أو الخصم',
          HttpStatus.CONFLICT,
        );
      }

      // وعاء العمولة (ADR-0037 + ADR-0038، docs/08 §60.1/§61.2) — بيتحسب بعد الضمان عشان
      // `warrantyPriceCents` يبقى متسجّل (السياسة ممكن تدخّله). **مش** بيتقصّ عند الإجمالي:
      // الخصم بتتحمّله المنصة بالكامل والفني بياخد مستحقه من السعر الأصلي (ADR-0038). بيتخزّن كـsnapshot
      // مش بيتعاد حسابه وقت التسوية — تغيير سياسة `commission_base.*` بعد كده بيأثّر على الطلبات
      // الجديدة بس، وطلب اتقفل يفضل زي ما هو للأبد.
      //
      // إعادة الزيارة تحت الضمان مجانية بالكامل (كل المكوّنات صفر) فالوعاء بيطلع صفر طبيعي.
      const commissionBasePolicy = await this.commissionBaseService.getPolicy();
      order.commissionableBaseCents = computeCommissionableBase(
        {
          basePriceCents: originalOrder || remoteQuoteRequested ? 0 : estimate.base_price_cents,
          levelPriceMultiplier: originalOrder ? 1 : estimate.level_price_multiplier,
          estimatedTotalCents: originalOrder || remoteQuoteRequested ? 0 : estimate.estimated_total_cents,
          inspectionFeeCents: order.inspectionFeeCents,
          emergencySurchargeCents: order.surgeAmountCents,
          addonsTotalCents: originalOrder || remoteQuoteRequested ? 0 : addonsTotalCents,
          discountCents: order.discountAmountCents,
          warrantyPriceCents: order.warrantyPriceCents,
          // فوايد/رسوم التقسيط مش بتتحمّل على الطلب وقت الإنشاء (خطة التقسيط بتتعمل بعد كده،
          // ورسومها بتتحصّل في مسار الأقساط نفسه) — فبتفضل صفر هنا. لو اتغيّر ده يومًا، المكوّن
          // موجود في العقد جاهز والسياسة بتاعته موجودة كمان.
          installmentInterestCents: 0,
        },
        commissionBasePolicy,
      ).commissionableBaseCents;
      await manager.save(order);

      // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — snapshot مبلغ الإيداع بعد كل الخصومات
      // (نفس سبب ترتيب requiresPrepay تحت بالحرف: النسبة بتتحسب على الإجمالي النهائي مش الخام).
      // إعادة الزيارة (originalOrder) وأي إجمالي صفر مستثنيان — مفيش إيداع لمبلغ صفر أصلاً.
      if (!originalOrder && !remoteQuoteRequested && service.depositRequired && order.totalAmountCents > 0) {
        order.depositAmountCents = Math.round((order.totalAmountCents * Number(service.depositPercentage)) / 100);
        await manager.save(order);
      }

      // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — بيتحدد هنا (بعد كل الخصومات، مش وقت إنشاء الصف
      // فوق) عشان لو خصم كامل (كود/عمارة) خلّى الإجمالي صفر، الطلب يتوزّع فورًا زي أي طلب مجاني
      // عادي بدل ما يعلّق PENDING_PAYMENT لمبلغ صفر مالوش معنى يتدفع. الطلب بيتسجّل SEARCHING_TECHNICIAN
      // فوق مبدئيًا؛ لو requiresPrepay صح بيتحدّث هنا لـPENDING_PAYMENT قبل ما history الوحيدة تتسجّل.
      const requiresPrepay = Boolean(requestedPrepayMethod) && order.totalAmountCents > 0;
      if (requiresPrepay) {
        order.orderStatus = OrderStatus.PENDING_PAYMENT;
        await manager.save(order);
      }

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: null,
          newStatus: order.orderStatus,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
        }),
      );

      // إثبات قبول شروط الدفع (migration 0177) — جوّه نفس transaction الطلب: القبول بيرتبط
      // بالطلب الفعلي (context order)، ولو الطلب فشل مفيش إثبات يتيم.
      for (const versionId of postpaidPolicyVersionIds) {
        await manager.query(
          `INSERT INTO payment_policy_acceptances (policy_version_id, user_id, context_type, context_id)
           VALUES ($1,$2,'order',$3)`,
          [versionId, userId, order.id],
        );
      }

      // ربط المشروع والمرحلة (migration 0179) — المرحلة لا معنى لها من غير مشروع، ولازم تكون
      // تابعة لنفس المشروع المملوك للعميل. الفحص القديم كان يسمح milestone_id منفردة أو مرحلة
      // من مشروع مختلف، فينتج طلب بعلاقات متعارضة لا تظهر صح في غرفة المشروع.
      if (dto.project_id || dto.milestone_id) {
        if (dto.milestone_id && !dto.project_id) {
          throw new ApiException(ErrorCode.VAL_001, 'اختيار مرحلة محتاج تحديد المشروع التابع لها', HttpStatus.BAD_REQUEST);
        }
        if (dto.project_id) {
          const [proj] = await manager.query(
            `SELECT id FROM projects WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL AND status IN ('active','awaiting_milestone_approval')`,
            [dto.project_id, customerProfile.id],
          );
          if (!proj) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود أو غير نشط', HttpStatus.BAD_REQUEST);
        }
        if (dto.milestone_id) {
          const [ms] = await manager.query(
            `SELECT m.id
             FROM project_milestones m
             JOIN projects p ON p.id = m.project_id
             WHERE m.id = $1 AND m.project_id = $2 AND p.customer_id = $3 AND p.deleted_at IS NULL`,
            [dto.milestone_id, dto.project_id, customerProfile.id],
          );
          if (!ms) throw new ApiException(ErrorCode.VAL_001, 'المرحلة غير موجودة داخل المشروع المحدد', HttpStatus.BAD_REQUEST);
        }
      }
      order.projectId = dto.project_id ?? null;
      order.milestoneId = dto.milestone_id ?? null;

      // "كرّر الحجز ده" (migration 0176) — القالب بيتإنشاء جوّه نفس transaction الطلب (ذرّي:
      // لو إنشاء الطلب فشل مفيش قالب يتيم، ولو القالب فشل الطلب بيترول باك كمان). الموعد الأول
      // للقالب = التكرار الجاي **بعد** الحجز المحجوز فعلاً. الحجز الحالي يظل order_type=standard
      // للتوافق، لكنه يُربط بالقالب ويُسجل كنوبة completed؛ وبكده يظهر في "كل الطلبات" وفي سجل
      // الحجز المتكرر بنفس الهوية بدل ما يبدو كطلب عادي منفصل.
      if (repeatPlanFrequency && order.scheduledAt) {
        const template = await manager.save(
          manager.create(RecurringOrderTemplate, {
            customerId: customerProfile.id,
            serviceId: service.id,
            addressId: address.id,
            bookingMode,
            // تفضيل الفني الفعلي المرتبط بالحجز ده (سلوت/تفضيل صريح) بيتكرر كـ"تفضيل مش ضمان"
            // بنفس دلالات requested_technician_id العادية — لو مش متاح وقت التوليد الطلب المتولّد
            // بيتوزّع عادي زي أي طلب.
            requestedTechnicianId: order.requestedTechnicianId,
            requestedTechnicianCompanyId: dto.requested_technician_company_id ?? null,
            // انتماء العمارة (migration 0257، docs/08 §125، طلب مالك صريح) — بلاغ: الطلب الأصلي
            // معمول بكود عمارة، ولازم النوبات الجاية تفضل مستفيدة من خصم العمارة مش تفقده بمجرد
            // إنه اتحوّل لقالب متكرر. `order.buildingId` هنا هو نفس المعرّف اللي اتحل من
            // `dto.building_code` فوق في نفس الدالة — مفيش استعلام إضافي.
            buildingId: order.buildingId,
            frequency: repeatPlanFrequency,
            fieldValues: dto.field_values ?? null,
            pricingQuantity: order.pricingQuantity,
            durationHours: order.durationHours,
            scheduledEndAt: order.scheduledEndAt,
            problemDescription: dto.problem_description ?? null,
            // نفس قيد chk_recurring_order_templates_payment_method (card/instapay بس — كاش/محفظة
            // دفعهم بعد الشغل، مالهمش معنى "قبل التوزيع" بيتكرر).
            // القوالب المتكررة الحالية تدعم card/instapay فقط. Fawry يحتاج كودًا مرجعيًا جديدًا
            // لكل نوبة وتدفق إشعار منفصل، لذلك لا نخزن قيمة غير مسموحة في القالب.
            paymentMethod: requestedPrepayMethod === 'fawry_reference' ? null : requestedPrepayMethod ?? null,
            nextRunAt: nextOccurrence(order.scheduledAt, repeatPlanFrequency),
            isActive: true,
          }),
        );
        order.recurringTemplateId = template.id;
        order.recurringOccurrenceAt = order.scheduledAt;
        await manager.save(order);
        await manager.query(
          `INSERT INTO recurring_order_occurrences
             (template_id, scheduled_for, status, attempt_count, completed_at, order_id)
           VALUES ($1, $2, 'completed', 1, now(), $3)`,
          [template.id, order.scheduledAt, order.id],
        );
        template.lastGeneratedOrderId = order.id;
        await manager.save(template);
      }

      return order;
      });
    } catch (err) {
      // سباق حقيقي: نداءين متزامنين بنفس الـidempotency key وصلوا هنا مع بعض (الفحص المبكر
      // قبل الـtransaction لسه ما لقاش حاجة للاتنين، TOCTOU عادي). الفهرس الفريد الجزئي
      // (migration 0139) بيرفض التاني، والـtransaction بتاعته بتترول باك بالكامل — بدل ما
      // نسرّب خطأ DB خام للعميل، نرجّع نفس الطلب اللي الأول عمله فعلاً (نفس فلسفة
      // PaymentsService.payWithWallet() بالحرف).
      if (idempotencyKey && this.isIdempotencyKeyViolation(err)) {
        const existing = await this.orders.findOne({ where: { customerId: customerProfile.id, idempotencyKey } });
        if (existing) return existing;
      }
      // ADR-0065 §5 — التأكيد فشل والطلب اترول باك. التذكرة **لازم تموت** بره الترانزاكشن
      // (اللي جواها اترول باك أصلاً)، وإلا العميل يقدر يعيد نفس التأكيد بنفس التذكرة ويفضل
      // يصطدم بنفس الرفض. بتتعلّم `stale` مش `consumed` — مااتستخدمتش، بطلت تصلح.
      if (selectedMatchPreview) {
        await this.dataSource
          .getRepository(BookingMatchPreview)
          .update({ id: selectedMatchPreview.id, status: 'active' }, { status: 'stale' })
          .catch(() => undefined);
      }
      throw err;
    }

    // ربط سجل تدقيق تسعير formula (لو الخدمة formula) بالطلب اللي اتأكّد فعلاً — snapshot
    // السعر التاريخي (docs/08 §1، طلب تتبّع السعر النهائي حتى لو الأدمن غيّر القواعد بعدين).
    // بره الـtransaction عمداً — تدقيق مش لازم يفشّل إنشاء الطلب لو فشل، ومحتاج order.id الحقيقي.
    if (estimate.pricing_evaluation_id) {
      await this.pricingEngineService.linkEvaluationToOrder(estimate.pricing_evaluation_id, createdOrder.id);
    }

    // Call Center — تدقيق الإنشاء نيابة عن العميل (Script 4 §37) — بره الـtransaction عمداً
    // (نفس فلسفة linkEvaluationToOrder فوق: تدقيق مش لازم يفشّل إنشاء الطلب لو فشل).
    if (callCenterContext) {
      await this.auditLog.record({
        actorUserId: callCenterContext.adminUserId,
        actorRole: 'admin',
        action: 'order.created_for_customer',
        entityType: 'order',
        entityId: createdOrder.id,
        newValues: { customer_id: customerProfile.id, customer_user_id: userId, service_id: service.id },
        meta: callCenterContext.meta,
      });
    }

    // دفع قبل التوزيع (ADR-0013 §3/§4/§12) — الطلب PENDING_PAYMENT: مفيش توزيع خالص لسه، فمفيش
    // داعي نصدّر ORDER_CREATED_EVENT دلوقتي. التصدير بيحصل لاحقًا (نفس الحدث بالظبط) من
    // PaymentsService.emitPaymentConfirmedEvents() بعد ما الدفع (كارت/InstaPay) يتأكد فعليًا —
    // طلب لسه مش مدفوع مش "اتعمل" فعليًا بالمعنى التجاري، ممكن ميتدفعش خالص. باقي أحداث النظام
    // (إشعارات "طلبك اتسجّل"، إحصائيات) هتنتظر برضو.
    if (createdOrder.orderStatus === OrderStatus.PENDING_PAYMENT) {
      return createdOrder;
    }

    // بره الـ transaction عمداً — matching لازم يشتغل على بيانات مؤكّدة (committed) بس. لازم
    // emitAsync (مش emit) هنا تحديدًا: بَقّة حقيقية اتلقطت واتصلحت — emit() عادي بيستدعي
    // الـ listeners من غير ما يستنى الـ promise بتاعهم (fire-and-forget)، يعني create() كانت
    // بترجع للعميل بـ 201 قبل ما OrderDispatchListener يخلّص إنشاء صفوف order_assignments في
    // DB. لو الفني (أو اختبار حي) نادى accept() فوراً بعد استلام رد إنشاء الطلب من غير أي تأخير
    // طبيعي، كان بيرجع "العرض ده مبقاش متاح" رغم إن الطلب لسه بيتوزّع. اتلقطت بـ curl مباشر
    // (نداءين متتاليين من غير أي تأخير) قبل ما نلاقيها كمان في اختبار Dart حي جديد. emitAsync
    // بتستنى كل الـ listeners (بما فيهم OrderDispatchListener) يخلّصوا قبل ما create() ترجع —
    // لطلب فوري/قريب من الموعد ده معناه التوزيع للفنيين المؤهلين خلص فعلاً وقت الرد؛ لطلب "بعيد"
    // باقي أحداث النظام (إشعارات، إحصائيات) لسه fire-and-forget عمداً — الاستثناء هنا بس لإن
    // قرار التوزيع ده جزء أساسي من دورة الطلب مش side effect.
    await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(createdOrder.id));

    return createdOrder;
  }

  // نفس نمط AdminOrdersService.isUniqueViolation() بالحرف — خطأ Postgres الخام (23505) بيتحوّل
  // لاسترجاع الطلب الأصلي بدل ما يتسرّب كـ500 عام (سباق idempotency-key حقيقي، راجع create() فوق).
  private isIdempotencyKeyViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === '23505' &&
      'constraint' in err &&
      (err as { constraint: unknown }).constraint === 'idx_orders_customer_idempotency_key'
    );
  }

  // معاينة السعر الحقيقي الكامل قبل تأكيد الحجز (docs/08 §1/§2) — كانت فجوة موثّقة صراحة:
  // apps/customer-app كان بيعرض إما basePriceCents الثابت (نموذج fixed) أو سعر formula خام
  // من غير رسوم الطوارئ/رسوم الفحص أصلاً (نموذج formula)، وأي منهم بلا الإضافات ولا الخصم —
  // رقم غامض ممكن يختلف عن المحصّل فعليًا. الحل: دالة معاينة read-only بتكرر **بالحرف** نفس
  // منطق تحديد المنطقة وحساب السعر في create() فوق (نفس catalogService.estimate() ونفس
  // حساب addonsTotalCents)، من غير أي كتابة/transaction/قفل — مفيش حاجة بتتغيّر في الداتابيز.
  // **قرار موثّق صراحة**: أي تعديل في منطق تسعير create() لازم يتعدّل هنا بالتوازي (نفس فلسفة
  // PromotionsService.previewForOrder() الموجودة من قبل لمعاينة كود الخصم بس).
  async previewPrice(userId: string, dto: PreviewOrderDto): Promise<PreviewOrderResponseDto> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const address = await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);
    const remoteAssessmentRequested = dto.request_remote_quote === true;
    // نفس الحارس اللي `create()` بيستخدمه بالحرف — نداء واحد لمنطق واحد، مش نسختين بتفرقوا.
    const previewRejection = assessmentRouteRejection(service, remoteAssessmentRequested ? 'remote' : 'onsite');
    if (previewRejection) throw new ApiException(ErrorCode.VAL_001, previewRejection, HttpStatus.BAD_REQUEST);
    if (remoteAssessmentRequested) {
      if (dto.addon_ids?.length || dto.promo_code || dto.building_code || dto.warranty_plan_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الإضافات والخصومات والضمان تتحدد بعد اعتماد سعر التقييم',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    await this.validatePricingFieldImages(
      this.dataSource.manager,
      customerProfile.id,
      userId,
      service.id,
      dto.field_values,
    );
    const optionalWarranty = await this.resolveOptionalWarranty(dto.warranty_plan_id, service.id);
    this.assertPricingQuantity(service.pricingModel, dto.pricing_quantity);
    const previewPeriod = contractPeriodFromFieldValues(dto.field_values);

    // نفس اشتقاق `create()` بالحرف (ADR-0048) — لازم يفضلوا متطابقين، وإلا المعاينة بتقول سعر
    // والتحصيل ياخد سعر تاني. السلوت بيلغي الاستعجال هنا كمان، بنفس السبب المشروح في `create()`.
    const urgent = !dto.schedule_slot_id && isSameDayUrgent({ scheduledAt: dto.scheduled_at ? new Date(dto.scheduled_at) : null });
    if (urgent && !canAcceptSameDay(service)) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مش متاحة لنفس اليوم — اختار يوم تاني', HttpStatus.BAD_REQUEST);
    }

    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    const [longitude, latitude] = address.location.coordinates;
    const zone = await this.geoService.findZoneForPoint(address.cityId, latitude, longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    // مضاعف سعر مستوى الفني (docs/08) — نفس منطق create() بالحرف، راجع تعليقها الكامل هناك.
    // سلوت الجدولة بيغلب requested_technician_id لو الاتنين موجودين (نفس أولوية create()).
    const scheduleSlotTechnicianProfile = dto.schedule_slot_id
      ? await this.techniciansService.findByProfileIdOrThrow(
          (await this.scheduleService.findAvailableSlotOrThrow(dto.schedule_slot_id)).technicianId,
        )
      : null;
    const requestedTechnicianProfile = dto.requested_technician_id
      ? await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id)
      : null;
    const previewTechnicianLevel = scheduleSlotTechnicianProfile?.currentLevel ?? requestedTechnicianProfile?.currentLevel;
    const previewTechnicianPricingTier = scheduleSlotTechnicianProfile?.pricingTier ?? requestedTechnicianProfile?.pricingTier;
    // ADR-0042 — نفس معامل الشركة اللي create() بيستعمله بالحرف، عشان المعاينة تطابق التحصيل.
    const previewCompany = dto.requested_technician_company_id
      ? await this.technicianCompaniesService.findActiveCompanyOrThrow(dto.requested_technician_company_id)
      : null;

    // ADR-0060 §2 — نفس مصدر `create()` بالحرف: الفترة من حقول الفورم. لو المعاينة قرأت من مكان
    // والإنشاء من مكان تاني، الرقمين هيختلفوا — وده بالظبط عكس الغرض من المعاينة.
    const pricingContext = buildPricingContext({
      scheduledAt: dto.scheduled_at,
      periodStart: previewPeriod.start,
      periodEnd: previewPeriod.end,
      serviceFieldValues: dto.field_values,
      zoneId: zone.id,
      isEmergency: urgent,
      technicianLevel: previewTechnicianLevel,
      addonIds: dto.addon_ids,
    });

    const estimate = await this.catalogService.estimate(
      service.id,
      zone.id,
      previewTechnicianLevel,
      urgent,
      dto.field_values,
      previewTechnicianPricingTier,
      undefined,
      undefined,
      previewCompany ? Number(previewCompany.priceMultiplier) : undefined,
      pricingContext,
    );
    if (Boolean(dto.standard_data_id) !== Boolean(dto.requested_units)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'standard_data_id وrequested_units لازم يتبعتوا مع بعض — مينفعش واحد من غير التاني',
        HttpStatus.BAD_REQUEST,
      );
    }
    const durationEstimate =
      dto.standard_data_id && dto.requested_units
        ? await this.catalogService.estimateDuration(service.id, dto.standard_data_id, dto.requested_units)
        : null;
    const requiredTechnicians = durationEstimate?.assigned_technicians ?? estimate.required_technicians ?? null;
    const requiredAssistants = durationEstimate?.assigned_assistants ?? estimate.required_assistants ?? null;
    const durationMinutes = estimate.duration_minutes != null ? Math.ceil(estimate.duration_minutes) : pricingContext.durationMinutes;
    if (urgent && estimate.suitable_for_emergency === false) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الخدمة دي مش مناسبة لطلب طوارئ بالمواصفات دي حسب سياسة التسعير — احجزها بموعد عادي',
        HttpStatus.BAD_REQUEST,
      );
    }
    const bookingMode = resolveBookingMode({ urgent, requiredTechnicians, requiredAssistants, service });
    const addons = await this.catalogService.findAddonsByIds(service.id, dto.addon_ids ?? []);
    const addonsTotalCents = addons.reduce((sum, addon) => sum + addon.priceCents, 0);

    if (dto.promo_code && dto.building_code) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش كود خصم وكود عمارة مع بعض', HttpStatus.BAD_REQUEST);
    }

    const subtotalBeforeDiscountCents = remoteAssessmentRequested
      ? service.remoteAssessmentFeeCents
      : estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents + addonsTotalCents;

    let discountCents = 0;
    let discountSource: 'promo_code' | 'building' | null = null;
    if (dto.promo_code) {
      const isNewCustomer = await this.customerProfiles.isNewCustomer(customerProfile.id);
      const { discountCents: preview } = await this.promoCodesService.preview(dto.promo_code, userId, {
        serviceId: service.id,
        zoneId: zone.id,
        totalBeforeDiscountCents: subtotalBeforeDiscountCents,
        inspectionFeeCents: estimate.inspection_fee_cents,
        isNewCustomer,
      });
      discountCents = preview;
      discountSource = 'promo_code';
    } else if (dto.building_code) {
      const building = await this.buildingsService.findActiveByCodeOrThrow(dto.building_code);
      discountCents = Math.round((subtotalBeforeDiscountCents * Number(building.discountPercentage)) / 100);
      discountSource = 'building';
    }

    const serviceTotalAfterDiscountCents = subtotalBeforeDiscountCents - discountCents;
    const warrantyPriceCents = this.optionalWarrantyPrice(optionalWarranty, serviceTotalAfterDiscountCents);
    const totalAmountCents = serviceTotalAfterDiscountCents + warrantyPriceCents;
    // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — نفس حساب create() بالحرف (راجع تعليق
    // depositAmountCents هناك). المعاينة لازم تطابق المحصّل الفعلي 100% (نفس مبدأ الملف كله).
    const depositAmountCents = !remoteAssessmentRequested && service.depositRequired && totalAmountCents > 0
      ? Math.round((totalAmountCents * Number(service.depositPercentage)) / 100)
      : null;

    return {
      base_price_cents: remoteAssessmentRequested ? 0 : estimate.estimated_total_cents,
      inspection_fee_cents: remoteAssessmentRequested ? 0 : estimate.inspection_fee_cents,
      min_price_cents: estimate.min_price_cents,
      max_price_cents: estimate.max_price_cents,
      emergency_surcharge_cents: remoteAssessmentRequested ? 0 : estimate.emergency_surcharge_cents,
      emergency_sla_minutes: remoteAssessmentRequested ? null : estimate.emergency_sla_minutes,
      addons: remoteAssessmentRequested
        ? []
        : addons.map((addon) => ({ id: addon.id, name_ar: addon.nameAr, price_cents: addon.priceCents })),
      addons_total_cents: remoteAssessmentRequested ? 0 : addonsTotalCents,
      optional_warranty: optionalWarranty
        ? {
            id: optionalWarranty.id,
            name_ar: optionalWarranty.name_ar,
            coverage_months: optionalWarranty.coverage_months,
            price_cents: warrantyPriceCents,
          }
        : null,
      warranty_price_cents: warrantyPriceCents,
      subtotal_before_discount_cents: subtotalBeforeDiscountCents,
      discount_cents: discountCents,
      discount_source: discountSource,
      total_amount_cents: totalAmountCents,
      estimated_duration_days: durationEstimate?.estimated_days ?? estimate.estimated_duration_days,
      level_price_multiplier: estimate.level_price_multiplier,
      deposit_amount_cents: depositAmountCents,
      due_now_cents: depositAmountCents ?? totalAmountCents,
      remaining_amount_cents: depositAmountCents !== null ? totalAmountCents - depositAmountCents : null,
      price_certainty_mode: service.priceCertaintyMode,
      // بند 10 — النطاق بيتحسب حوالين السعر المحسوب فعلاً للمدخلات دي، مش الحقول الثابتة.
      // من غير كده خدمة سعرها بيتغيّر حسب الشغل كانت بتعرض نفس النطاق دايمًا.
      ...estimatedDisplayRange(service, totalAmountCents),
      remote_assessment_fee_cents: remoteAssessmentRequested ? service.remoteAssessmentFeeCents : 0,
      booking_mode: bookingMode,
      service_zone_id: zone.id,
      duration_minutes: durationMinutes,
      required_technicians: requiredTechnicians,
      required_assistants: requiredAssistants,
    };
  }
  /**
   * إعادة جدولة الطلب لموعد تاني عند نفس الفني (docs/08 §22 بند 9-12) — تحرير السلوت القديم
   * وحجز الجديد ذرّيًا جوّه transaction واحدة (TechnicianScheduleService.rescheduleSlot، بيستخدم
   * bookSlot() الذرّية وراها) — لو السلوت الجديد اتحجز من عميل تاني بينهم، الحجز يفشل والقديم
   * يترجع تلقائيًا (rollback)، صفر حجز مزدوج صامت ممكن يحصل بأي حال.
   */
  /**
   * دقة الوقت (ADR-0031 Slice B) — فحص تعارض حقيقي بدقة ساعة لفني معروف صراحة سلفًا (تفضيل أو
   * سلوت)، لخدمات `requires_precise_schedule=true`. نفس فكرة `DomesticWorkersService.findSchedulingConflict()`
   * القديمة (اتلغت مع بنية الشغالة المنفصلة، ADR-0031) بس معمّمة على `orders.technician_id` لأي
   * فني عادي بدل جدول حجوزات منفصل. مقصورة على `orders` بس — الفني هنا فني عادي، مفيش جدول تاني.
   */
  /**
   * بَقّة حقيقية بلّغها المالك (docs/08 §113، ADR-0060): الشرط هنا كان مكتوب بإيد
   * (`PER_UNIT || MONTHLY`) بدل ما يتقرا من سجل الطرق. ADR-0050 §4 حوّلت `monthly` لفترة
   * تاريخين (`requires: 'period'`) وحدّثت السجل، بس الحارس ده فضل شايفها محسوبة بالكمية —
   * فخدمة شهرية كانت بتتطلب رقم كمية **مفيش أي شاشة بتطلبه أصلاً**، والحجز يقف على رسالة
   * «لازم تحدد عدد الوحدات المطلوبة لهذه الخدمة» بلا أي حقل يقدر يرضيها.
   *
   * دلوقتي مصدر واحد: `pricingMethod(model).requires`.
   */
  private assertPricingQuantity(_pricingModel: PricingModel, quantity?: number): void {
    if (quantity != null) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الكمية بقت حقل في فورم الخدمة نفسها مش مدخل منفصل — ابعتها جوّه field_values',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
