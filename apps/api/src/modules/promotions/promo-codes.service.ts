import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { ListPromoCodesQueryDto } from './dto/list-promo-codes-query.dto';
import { DiscountType, PromoCode } from './entities/promo-code.entity';
import { PromoCodeUsage } from './entities/promo-code-usage.entity';

export interface PromoApplicationContext {
  serviceId: string;
  zoneId: string;
  totalBeforeDiscountCents: number;
  inspectionFeeCents: number;
  isNewCustomer: boolean;
}

export interface PromoApplicationResult {
  promoCode: PromoCode;
  discountCents: number;
}

@Injectable()
export class PromoCodesService {
  constructor(
    @InjectRepository(PromoCode) private readonly promoCodes: Repository<PromoCode>,
    @InjectRepository(PromoCodeUsage) private readonly usages: Repository<PromoCodeUsage>,
    private readonly auditLog: AuditLogService,
  ) {}

  private computeDiscount(promoCode: PromoCode, ctx: PromoApplicationContext): number {
    let discount: number;
    switch (promoCode.discountType) {
      case DiscountType.PERCENTAGE:
        discount = Math.round((ctx.totalBeforeDiscountCents * Number(promoCode.discountValue)) / 100);
        break;
      case DiscountType.FIXED_AMOUNT:
        discount = Math.round(Number(promoCode.discountValue) * 100);
        break;
      case DiscountType.FREE_INSPECTION:
        discount = ctx.inspectionFeeCents;
        break;
      default:
        discount = 0;
    }
    if (promoCode.maxDiscountCents !== null) {
      discount = Math.min(discount, promoCode.maxDiscountCents);
    }
    // مينفعش الخصم يتعدى قيمة الطلب نفسها — مفيش "رصيد سالب" من كود خصم
    return Math.max(0, Math.min(discount, ctx.totalBeforeDiscountCents));
  }

  /** بيتحقق من كل شروط الكود من غير ما يقفل الصف أو يسجّل استخدام — للمعاينة قبل إنشاء الطلب بس، مش قرار نهائي. */
  private assertUsable(promoCode: PromoCode, userId: string, ctx: PromoApplicationContext, usedByUserCount: number): void {
    const now = new Date();
    if (!promoCode.isActive || promoCode.deletedAt) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده مش شغال', HttpStatus.BAD_REQUEST);
    }
    if (now < promoCode.validFrom || now > promoCode.validUntil) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده منتهي أو لسه مبدأش', HttpStatus.BAD_REQUEST);
    }
    if (ctx.totalBeforeDiscountCents < promoCode.minOrderAmountCents) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `الحد الأدنى لاستخدام الكود ده ${promoCode.minOrderAmountCents / 100} جنيه`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (promoCode.appliesToServiceIds && !promoCode.appliesToServiceIds.includes(ctx.serviceId)) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده مش شغال على الخدمة دي', HttpStatus.BAD_REQUEST);
    }
    if (promoCode.appliesToZoneIds && !promoCode.appliesToZoneIds.includes(ctx.zoneId)) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده مش شغال في منطقتك', HttpStatus.BAD_REQUEST);
    }
    if (promoCode.newCustomersOnly && !ctx.isNewCustomer) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده للعملاء الجداد بس', HttpStatus.BAD_REQUEST);
    }
    // إصلاح أمني (migration 0067) — كان فيه فجوة موثّقة: مكافآت الترشيح (referrals.service.ts)
    // كانت بتتصدر كـpromo_codes عادي بلا أي قيد يمنع غير المُرشِّح من استخدامها لو الكود اتسرّب.
    if (promoCode.restrictedToUserId && promoCode.restrictedToUserId !== userId) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده مش بتاعك', HttpStatus.FORBIDDEN);
    }
    if (promoCode.usageLimitTotal !== null && promoCode.usedCount >= promoCode.usageLimitTotal) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده خلص من الاستخدام', HttpStatus.BAD_REQUEST);
    }
    if (usedByUserCount >= promoCode.usageLimitPerUser) {
      throw new ApiException(ErrorCode.VAL_001, 'استخدمت الكود ده أقصى عدد مرات مسموح بيه', HttpStatus.BAD_REQUEST);
    }
    const discount = this.computeDiscount(promoCode, ctx);
    if (promoCode.budgetCents !== null && promoCode.spentCents + discount > promoCode.budgetCents) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم ده وصل لأقصى ميزانية متاحة', HttpStatus.BAD_REQUEST);
    }
  }

  async preview(code: string, userId: string, ctx: PromoApplicationContext): Promise<PromoApplicationResult> {
    const promoCode = await this.promoCodes.findOne({ where: { code: code.toUpperCase() } });
    if (!promoCode) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم غير موجود', HttpStatus.NOT_FOUND);
    }
    const usedByUserCount = await this.usages.count({ where: { promoCodeId: promoCode.id, userId } });
    this.assertUsable(promoCode, userId, ctx, usedByUserCount);
    return { promoCode, discountCents: this.computeDiscount(promoCode, ctx) };
  }

  /**
   * نفس منطق preview() بالظبط، بس جوّه نفس transaction إنشاء الطلب ومع قفل ذرّي على صف
   * الكود — عشان طلبين يحاولوا يستخدموا نفس الكود في نفس اللحظة ميتجاوزوش usage_limit_total
   * أو budget_cents سوا. لازم يتنادى بنفس manager بتاع transaction الطلب، مش منفصل.
   */
  async validateAndApply(
    manager: EntityManager,
    code: string,
    userId: string,
    orderId: string,
    ctx: PromoApplicationContext,
  ): Promise<PromoApplicationResult> {
    const promoCode = await manager
      .createQueryBuilder(PromoCode, 'p')
      .setLock('pessimistic_write')
      .where('p.code = :code', { code: code.toUpperCase() })
      .andWhere('p.deleted_at IS NULL')
      .getOne();

    if (!promoCode) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الخصم غير موجود', HttpStatus.NOT_FOUND);
    }

    const usedByUserCount = await manager.count(PromoCodeUsage, { where: { promoCodeId: promoCode.id, userId } });
    this.assertUsable(promoCode, userId, ctx, usedByUserCount);
    const discountCents = this.computeDiscount(promoCode, ctx);

    await manager.increment(PromoCode, { id: promoCode.id }, 'usedCount', 1);
    await manager.increment(PromoCode, { id: promoCode.id }, 'spentCents', discountCents);
    await manager.save(
      manager.create(PromoCodeUsage, {
        promoCodeId: promoCode.id,
        userId,
        orderId,
        discountAppliedCents: discountCents,
      }),
    );

    return { promoCode, discountCents };
  }

  /**
   * ترجيع استخدام كود خصم بعد إلغاء الطلب اللي استخدمه (§24 — كانت فجوة موثّقة صراحة: usedCount/
   * spentCents بيتزودوا في validateAndApply() بس مفيش أي decrement في أي مسار إلغاء، فكود محدود
   * الاستخدام كان ممكن "يخلص" بسبب طلبات اتلغت قبل أي خدمة فعلية). Idempotent (released_at IS NULL
   * guard) وبقفل ذرّي على صف الاستخدام — آمن يتنادى من أي عدد مسارات إلغاء بلا خطر تكرار الترجيع.
   * لازم يتنادى جوّه نفس transaction إلغاء الطلب (مش استدعاء منفصل).
   */
  async releaseUsage(manager: EntityManager, orderId: string): Promise<void> {
    const usage = await manager
      .createQueryBuilder(PromoCodeUsage, 'u')
      .setLock('pessimistic_write')
      .where('u.order_id = :orderId', { orderId })
      .andWhere('u.released_at IS NULL')
      .getOne();

    if (!usage) return; // الطلب ده ماستخدمش كود خصم أصلاً، أو الاستخدام اترجع قبل كده

    await manager.increment(PromoCode, { id: usage.promoCodeId }, 'usedCount', -1);
    await manager.increment(PromoCode, { id: usage.promoCodeId }, 'spentCents', -usage.discountAppliedCents);
    usage.releasedAt = new Date();
    await manager.save(usage);
  }

  // ── إدارة الأدمن ─────────────────────────────────────────────────────

  private async createWithRepository(
    repository: Repository<PromoCode>,
    adminUserId: string,
    dto: CreatePromoCodeDto,
  ): Promise<PromoCode> {
    const code = dto.code.toUpperCase();
    const existing = await repository.findOne({ where: { code } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الكود ده مستخدم قبل كده', HttpStatus.CONFLICT);
    }
    const validFrom = new Date(dto.valid_from);
    const validUntil = new Date(dto.valid_until);
    if (validUntil <= validFrom) {
      throw new ApiException(ErrorCode.VAL_001, 'تاريخ الانتهاء لازم يكون بعد تاريخ البداية', HttpStatus.BAD_REQUEST);
    }

    const promoCode = repository.create({
      code,
      nameAr: dto.name_ar,
      discountType: dto.discount_type,
      discountValue: String(dto.discount_value),
      maxDiscountCents: dto.max_discount_cents ?? null,
      minOrderAmountCents: dto.min_order_amount_cents ?? 0,
      usageLimitTotal: dto.usage_limit_total ?? null,
      usageLimitPerUser: dto.usage_limit_per_user ?? 1,
      appliesToServiceIds: dto.applies_to_service_ids ?? null,
      appliesToZoneIds: dto.applies_to_zone_ids ?? null,
      newCustomersOnly: dto.new_customers_only ?? false,
      validFrom,
      validUntil,
      createdByUserId: adminUserId,
      budgetCents: dto.budget_cents ?? null,
      restrictedToUserId: dto.restricted_to_user_id ?? null,
    });
    await repository.save(promoCode);
    return promoCode;
  }

  async createInTransaction(manager: EntityManager, adminUserId: string, dto: CreatePromoCodeDto): Promise<PromoCode> {
    return this.createWithRepository(manager.getRepository(PromoCode), adminUserId, dto);
  }

  async create(adminUserId: string, dto: CreatePromoCodeDto, meta?: AuditActorMeta): Promise<PromoCode> {
    return this.promoCodes.manager.transaction(async (manager) => {
      const promoCode = await this.createWithRepository(manager.getRepository(PromoCode), adminUserId, dto);
      await this.recordCreatedAudit(adminUserId, promoCode, meta, manager);
      return promoCode;
    });
  }

  async recordCreatedAudit(
    adminUserId: string,
    promoCode: PromoCode,
    meta?: AuditActorMeta,
    manager?: EntityManager,
  ): Promise<void> {
    await this.auditLog.record(
      {
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'promo_code.created',
        entityType: 'promo_code',
        entityId: promoCode.id,
        newValues: { code: promoCode.code, discount_type: promoCode.discountType, discount_value: promoCode.discountValue },
        meta,
      },
      manager,
    );
  }

  async list(query: ListPromoCodesQueryDto): Promise<{ items: PromoCode[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const [items, total] = await this.promoCodes.findAndCount({
      where: query.is_active !== undefined ? { isActive: query.is_active } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { items, meta: { page, per_page: perPage, total } };
  }

  async deactivate(id: string, adminUserId: string, meta?: AuditActorMeta): Promise<PromoCode> {
    return this.promoCodes.manager.transaction(async (manager) => {
      const promoCode = await manager
        .createQueryBuilder(PromoCode, 'promo')
        .setLock('pessimistic_write')
        .where('promo.id = :id', { id })
        .andWhere('promo.deleted_at IS NULL')
        .getOne();
      if (!promoCode) {
        throw new ApiException(ErrorCode.VAL_001, 'كود الخصم غير موجود', HttpStatus.NOT_FOUND);
      }
      promoCode.isActive = false;
      await manager.save(promoCode);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'promo_code.deactivated',
          entityType: 'promo_code',
          entityId: promoCode.id,
          newValues: { code: promoCode.code, is_active: false },
          meta,
        },
        manager,
      );
      return promoCode;
    });
  }
}
