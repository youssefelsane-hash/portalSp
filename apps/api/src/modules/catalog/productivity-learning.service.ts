import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { SettingsService } from '../settings/settings.service';
import { ProductivityActualSource, ServiceProductivityActual } from './entities/service-productivity-actual.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import {
  ProductivitySuggestionStatus,
  ServiceProductivitySuggestion,
} from './entities/service-productivity-suggestion.entity';

const MEMBER_TYPE_ASSISTANT = 'assistant';
const MEMBER_TYPE_TEAM_MEMBER = 'team_member';
const MIN_SAMPLE_SIZE_FALLBACK = 5;
const MIN_CHANGE_PERCENTAGE_FALLBACK = 5;
const SUGGESTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // ساعة — مش وقتي زي matching، فحص دوري بطيء كافي

/**
 * محرك الإنتاجية الذاتي التعلّم — مرحلة 2 (docs/06 §3.9، migration 0077). كانت فجوة موثّقة
 * صراحة: "تسجيل يدوي فقط، لسه مش مربوطة تلقائيًا بالطلبات... مفيش automatic learning من
 * completed orders ولا suggested standard update".
 *
 * الـpipeline: (1) `captureFromCompletedOrder()` بتتنادى من listener على ORDER_STATUS_CHANGED_EVENT
 * لحظة ما طلب بـstandard_data_id يوصل COMPLETED — observation تلقائي (source=system_auto) بلا
 * تدخل يدوي. (2) `generateSuggestions()` فحص دوري (نفس فلسفة OrderAutoCancelService — setInterval
 * مش BullMQ، عشان الاستقلال عن مشكلة Worker/Redis reconnection الموثّقة في technicians/README.md)
 * بيجمّع الـobservations الجديدة، يحسب median القيم المُطبّعة، ويولّد اقتراح لو العينة كافية
 * والفرق مش تافه. (3) موافقة/رفض الأدمن الصريحة (`approveSuggestion`/`rejectSuggestion`) —
 * **مفيش تحديث تلقائي لـproductivity_per_day بلا موافقة**، القرار للمالك دايمًا.
 */
@Injectable()
export class ProductivityLearningService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductivityLearningService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderTeamMember) private readonly teamMembers: Repository<OrderTeamMember>,
    @InjectRepository(ServiceStandardData) private readonly standardData: Repository<ServiceStandardData>,
    @InjectRepository(ServiceProductivityActual) private readonly actuals: Repository<ServiceProductivityActual>,
    @InjectRepository(ServiceProductivitySuggestion) private readonly suggestions: Repository<ServiceProductivitySuggestion>,
    private readonly settingsService: SettingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.generateSuggestions().catch((err) =>
        this.logger.error('فشل توليد اقتراحات الإنتاجية', err instanceof Error ? err.stack : err),
      );
    }, SUGGESTION_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * observation تلقائي عند إكمال طلب حقيقي مربوط بـstandard_data_id — بيتنادى من
   * OrderCompletedProductivityListener. actual_units من orders.requested_units (snapshot وقت
   * الحجز، migration 0077)، actual_days من فرق work_started_at/work_completed_at (يوم واحد على
   * الأقل — طلب بدأ وخلص في نفس اليوم لسه "يوم شغل واحد")، actual_technicians/assistants من عدد
   * order_team_members الفعليين + قائد الطلب نفسه (1). فشل الالتقاط (بيانات ناقصة، نادر) بيتسجّل
   * بس ومايكسرش دورة إكمال الطلب — نفس فلسفة أي مستمع حدث ثانوي في المشروع.
   */
  async captureFromCompletedOrder(orderId: string): Promise<void> {
    try {
      const order = await this.orders.findOne({ where: { id: orderId } });
      if (!order || !order.standardDataId || !order.requestedUnits) return;
      if (!order.workStartedAt || !order.workCompletedAt) return;

      const actualDays = Math.max(
        1,
        Math.ceil((order.workCompletedAt.getTime() - order.workStartedAt.getTime()) / (24 * 60 * 60 * 1000)),
      );

      const members = await this.teamMembers.find({ where: { orderId } });
      const actualTechnicians = 1 + members.filter((m) => m.memberType === MEMBER_TYPE_TEAM_MEMBER).length;
      const actualAssistants = members.filter((m) => m.memberType === MEMBER_TYPE_ASSISTANT).length;

      await this.actuals.save(
        this.actuals.create({
          serviceStandardDataId: order.standardDataId,
          orderId: order.id,
          actualUnits: order.requestedUnits,
          actualDays: String(actualDays),
          actualTechnicians,
          actualAssistants,
          source: ProductivityActualSource.SYSTEM_AUTO,
        }),
      );
    } catch (err) {
      this.logger.error(`فشل التقاط observation إنتاجية للطلب ${orderId}`, err instanceof Error ? err.stack : err);
    }
  }

  /**
   * تجميع دوري — لكل service_standard_data نشطة، بيجمع observations `system_auto` اللي اتسجّلت
   * بعد آخر اقتراح (أو كلها لو مفيش اقتراح قبل كده)، ويحسب median معدّل الإنتاجية المُطبّع على
   * أساس min_technicians (نفس صيغة CatalogService.estimateDuration() بالظبط، عكسيًا) — عشان
   * القيمة المقترحة تفضل قابلة للمقارنة المباشرة بـproductivity_per_day الحالية. بيتجاهل
   * standard_data لو عندها اقتراح `pending` لسه — مفيش اقتراحات متراكمة لنفس الصف.
   */
  async generateSuggestions(): Promise<number> {
    const minSampleSize = await this.settingsService.getNumber('productivity_learning.min_sample_size', MIN_SAMPLE_SIZE_FALLBACK);
    const minChangePercentage = await this.settingsService.getNumber(
      'productivity_learning.min_change_percentage',
      MIN_CHANGE_PERCENTAGE_FALLBACK,
    );

    const rows = await this.standardData.find({ where: { isActive: true } });
    let created = 0;

    for (const row of rows) {
      const hasPending = await this.suggestions.findOne({
        where: { serviceStandardDataId: row.id, status: ProductivitySuggestionStatus.PENDING },
      });
      if (hasPending) continue;

      const lastSuggestion = await this.suggestions.findOne({
        where: { serviceStandardDataId: row.id },
        order: { createdAt: 'DESC' },
      });

      const newActuals = await this.actuals.find({
        where: {
          serviceStandardDataId: row.id,
          source: ProductivityActualSource.SYSTEM_AUTO,
          ...(lastSuggestion ? { createdAt: MoreThan(lastSuggestion.createdAt) } : {}),
        },
      });
      if (newActuals.length < minSampleSize) continue;

      const minTechnicians = row.minTechnicians;
      const normalizedRates = newActuals
        .map((a) => {
          const units = Number(a.actualUnits);
          const days = Number(a.actualDays);
          const technicians = a.actualTechnicians;
          if (days <= 0 || technicians <= 0) return null;
          // عكس CatalogService.estimateDuration()'s effectiveProductivity = baseProductivity *
          // (technicians / minTechnicians) — هنا بنرجع من المعدل الفعلي (units/days) لنفس أساس
          // minTechnicians، عشان يتقارن مباشرة مع productivity_per_day المخزّنة.
          return (units / days) * (minTechnicians / technicians);
        })
        .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);
      if (normalizedRates.length < minSampleSize) continue;

      const median = this.median(normalizedRates);
      const current = Number(row.productivityPerDay);
      const changePercentage = current > 0 ? (Math.abs(median - current) / current) * 100 : 100;
      if (changePercentage < minChangePercentage) continue;

      const confidence = this.confidenceScore(normalizedRates, median);

      await this.suggestions.save(
        this.suggestions.create({
          serviceStandardDataId: row.id,
          currentProductivityPerDay: row.productivityPerDay,
          suggestedProductivityPerDay: median.toFixed(2),
          sampleSize: normalizedRates.length,
          confidenceScore: confidence.toFixed(3),
        }),
      );
      created += 1;
    }

    if (created > 0) this.logger.log(`اتولّد ${created} اقتراح إنتاجية جديد`);
    return created;
  }

  private median(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * ثقة استرشادية من 0 لـ1 — مركّبة من حجم العينة (كل ما زاد لحد سقف، زادت الثقة) وثبات القيم
   * (تباين أقل حوالين الـmedian = ثقة أعلى). قرار تصميم مقصود: heuristic بسيط شفّاف مش نموذج
   * إحصائي معقّد — الهدف مؤشر استرشادي للأدمن قبل الموافقة، مش قرار آلي نهائي.
   */
  private confidenceScore(values: number[], median: number): number {
    const sampleSizeScore = Math.min(values.length / 20, 1) * 0.6;
    const meanAbsDeviation = values.reduce((sum, v) => sum + Math.abs(v - median), 0) / values.length;
    const coefficientOfVariation = median > 0 ? meanAbsDeviation / median : 1;
    const stabilityScore = Math.max(0, 1 - coefficientOfVariation) * 0.4;
    return Math.min(1, Math.max(0, sampleSizeScore + stabilityScore));
  }

  listSuggestions(status?: ProductivitySuggestionStatus): Promise<ServiceProductivitySuggestion[]> {
    return this.suggestions.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  private async findSuggestionOrThrow(id: string): Promise<ServiceProductivitySuggestion> {
    const suggestion = await this.suggestions.findOne({ where: { id } });
    if (!suggestion) {
      throw new ApiException(ErrorCode.VAL_001, 'اقتراح الإنتاجية غير موجود', HttpStatus.NOT_FOUND);
    }
    if (suggestion.status !== ProductivitySuggestionStatus.PENDING) {
      throw new ApiException(ErrorCode.VAL_001, 'الاقتراح ده اتراجع بالفعل', HttpStatus.CONFLICT);
    }
    return suggestion;
  }

  async approveSuggestion(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<ServiceProductivitySuggestion> {
    const suggestion = await this.findSuggestionOrThrow(id);
    const row = await this.standardData.findOne({ where: { id: suggestion.serviceStandardDataId } });
    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'البيانات القياسية غير موجودة', HttpStatus.NOT_FOUND);
    }

    const oldValue = row.productivityPerDay;
    row.productivityPerDay = suggestion.suggestedProductivityPerDay;
    await this.standardData.save(row);

    suggestion.status = ProductivitySuggestionStatus.APPROVED;
    suggestion.reviewedAt = new Date();
    suggestion.reviewedByUserId = adminUserId;
    await this.suggestions.save(suggestion);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'productivity_suggestion.approved',
      entityType: 'service_standard_data',
      entityId: row.id,
      oldValues: { productivity_per_day: oldValue },
      newValues: { productivity_per_day: row.productivityPerDay, sample_size: suggestion.sampleSize },
      meta,
    });
    return suggestion;
  }

  async rejectSuggestion(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<ServiceProductivitySuggestion> {
    const suggestion = await this.findSuggestionOrThrow(id);
    suggestion.status = ProductivitySuggestionStatus.REJECTED;
    suggestion.reviewedAt = new Date();
    suggestion.reviewedByUserId = adminUserId;
    await this.suggestions.save(suggestion);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'productivity_suggestion.rejected',
      entityType: 'service_productivity_suggestion',
      entityId: suggestion.id,
      meta,
    });
    return suggestion;
  }
}
