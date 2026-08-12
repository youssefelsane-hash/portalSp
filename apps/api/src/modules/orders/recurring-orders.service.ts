import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { TechniciansService } from '../technicians/technicians.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateRecurringTemplateDto } from './dto/create-recurring-template.dto';
import { UpdateRecurringTemplateDto } from './dto/update-recurring-template.dto';
import { BookingMode, OrderType } from './entities/order.entity';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { OrdersService } from './orders.service';

const SWEEP_INTERVAL_MS = 60_000;

function nextOccurrence(from: Date, frequency: RecurringOrderFrequency): Date {
  const next = new Date(from);
  switch (frequency) {
    case RecurringOrderFrequency.WEEKLY:
      next.setDate(next.getDate() + 7);
      break;
    case RecurringOrderFrequency.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      break;
    case RecurringOrderFrequency.YEARLY:
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

/**
 * الجدولة المستقبلية/المتكررة (docs/08 §11) — order_type='recurring' كان قيمة enum من الأول
 * (migration 0002) بس بلا آلية توليد حقيقية. القالب هنا بيولّد طلب حقيقي عبر `OrdersService.create()`
 * نفسها (صفر تكرار منطق تسعير/تحقق) في كل موعد مستحق.
 *
 * **قرار تصميم متعمّد**: فحص دوري (`setInterval`) مش BullMQ repeatable job — نفس فلسفة
 * `OrderAutoCancelService` بالحرف (راجع تعليقها الكامل هناك). لو استخدمنا BullMQ هنا، "الالتزام
 * المتكرر" كان هيعتمد على نفس الـ Worker اللي عنده بَقّة recovery موثّقة بعد انقطاع Redis طويل.
 *
 * **تفضيل الفني مش ضمان**: `requested_technician_id` بيتمرّر لـ`OrdersService.create()` زي أي
 * "إعادة حجز" عادي — لو الفني مش متاح وقت التوليد، الطلب المولّد بيرجع للتوزيع العادي تلقائيًا
 * (نفس السلوك الموثّق في `matching/README.md`)، مش بيتلغي أو يستنى. مفيش قفل/حجز سلوت مسبق هنا —
 * خارج نطاق v1، القالب بيولّد الطلب بس زي لو العميل بنفسه حجزه في اللحظة دي بالظبط.
 */
@Injectable()
export class RecurringOrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringOrdersService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(RecurringOrderTemplate) private readonly templates: Repository<RecurringOrderTemplate>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly catalogService: CatalogService,
    private readonly techniciansService: TechniciansService,
    private readonly ordersService: OrdersService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('فشل sweep الطلبات المتكررة', err instanceof Error ? err.stack : err));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async create(userId: string, dto: CreateRecurringTemplateDto): Promise<RecurringOrderTemplate> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);
    if (dto.requested_technician_id) {
      await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id);
    }

    // نفس فحص OrdersService.create() بالحرف — كانت فجوة حقيقية اتلقطت وقت بناء واجهة العميل:
    // مفيش تحقق هنا خالص، يعني العميل كان يقدر ينشئ قالب متكرر بـbooking_mode مش متاح للخدمة
    // (مثلاً "فرد" لخدمة بتدعم "فريق" بس) وياخد رد 200 ناجح — بعدين generateFromTemplate() كانت
    // هتفشل بصمت كل موعد للأبد (next_run_at بيتحرك قدّام حتى لو الطلب الحقيقي فشل، بتصميم متعمد،
    // راجع تعليق generateFromTemplate() تحت) من غير ما العميل ياخد أي تنبيه إنه القالب معطوب.
    const bookingMode = dto.booking_mode ?? BookingMode.INDIVIDUAL;
    const bookingModeAllowed =
      bookingMode === BookingMode.INDIVIDUAL
        ? service.allowsIndividual
        : bookingMode === BookingMode.TEAM
          ? service.allowsTeam
          : service.allowsEmergency;
    if (!bookingModeAllowed) {
      throw new ApiException(ErrorCode.VAL_001, 'وضع الحجز ده مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }

    const startsAt = new Date(dto.starts_at);
    if (startsAt.getTime() <= Date.now()) {
      throw new ApiException(ErrorCode.VAL_001, 'أول موعد تنفيذ لازم يكون في المستقبل', HttpStatus.BAD_REQUEST);
    }

    const template = this.templates.create({
      customerId: customerProfile.id,
      serviceId: dto.service_id,
      addressId: dto.address_id,
      bookingMode: dto.booking_mode,
      requestedTechnicianId: dto.requested_technician_id ?? null,
      frequency: dto.frequency,
      problemDescription: dto.problem_description ?? null,
      nextRunAt: startsAt,
      isActive: true,
    });
    return this.templates.save(template);
  }

  async listForCustomer(userId: string): Promise<RecurringOrderTemplate[]> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    return this.templates.find({ where: { customerId: customerProfile.id }, order: { createdAt: 'DESC' } });
  }

  private async findOwnedOrThrow(userId: string, templateId: string): Promise<RecurringOrderTemplate> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const template = await this.templates.findOne({ where: { id: templateId, customerId: customerProfile.id } });
    if (!template) {
      throw new ApiException(ErrorCode.VAL_001, 'القالب المتكرر غير موجود', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  async update(userId: string, templateId: string, dto: UpdateRecurringTemplateDto): Promise<RecurringOrderTemplate> {
    const template = await this.findOwnedOrThrow(userId, templateId);
    template.isActive = dto.is_active;
    return this.templates.save(template);
  }

  async remove(userId: string, templateId: string): Promise<void> {
    const template = await this.findOwnedOrThrow(userId, templateId);
    await this.templates.softDelete(template.id);
  }

  async sweep(): Promise<number> {
    const dueTemplates = await this.templates.find({
      where: { isActive: true, nextRunAt: LessThanOrEqual(new Date()) },
    });

    let generatedCount = 0;
    for (const template of dueTemplates) {
      const generated = await this.generateFromTemplate(template);
      if (generated) generatedCount++;
    }
    if (generatedCount > 0) {
      this.logger.log(`الطلبات المتكررة: ${generatedCount} طلب اتولّد تلقائيًا`);
    }
    return generatedCount;
  }

  /**
   * بيولّد طلب واحد ويحرّك next_run_at قدّام — مستقل عن نجاح/فشل إنشاء الطلب نفسه (لو فشل
   * إنشاء الطلب لسبب مؤقت، next_run_at لسه بيتحرّك عشان القالب ميفضلش عالق يحاول يولّد نفس
   * الموعد الفايت كل دقيقة للأبد — نفس فلسفة "مش هنعلّق على فشل مؤقت" في CLAUDE.md).
   */
  private async generateFromTemplate(template: RecurringOrderTemplate): Promise<boolean> {
    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(template.customerId);
    const createOrderDto: CreateOrderDto = {
      service_id: template.serviceId,
      address_id: template.addressId,
      booking_mode: template.bookingMode,
      order_type: OrderType.RECURRING,
      requested_technician_id: template.requestedTechnicianId ?? undefined,
      problem_description: template.problemDescription ?? undefined,
    };

    let generatedOrderId: string | null = null;
    try {
      const order = await this.ordersService.create(customerProfile.userId, createOrderDto);
      generatedOrderId = order.id;
    } catch (err) {
      this.logger.error(
        `فشل توليد طلب من القالب المتكرر ${template.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    template.nextRunAt = nextOccurrence(template.nextRunAt, template.frequency);
    if (generatedOrderId) {
      template.lastGeneratedOrderId = generatedOrderId;
    }
    await this.templates.save(template);
    return generatedOrderId !== null;
  }
}
