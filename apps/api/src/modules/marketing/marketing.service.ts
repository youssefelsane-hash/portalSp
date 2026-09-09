import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { randomInt } from 'node:crypto';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SettingsService } from '../settings/settings.service';
import { MarketingAttribution } from './entities/marketing-attribution.entity';
import { MarketingHitPlatform, MarketingLinkHit } from './entities/marketing-link-hit.entity';
import { MarketingChannel, MarketingSource } from './entities/marketing-source.entity';
import { MarketingSourceCommission } from './entities/marketing-source-commission.entity';

/**
 * حروف الكود المطبوع — **من غير `0/O/1/I/5/S`** عن قصد.
 *
 * الكود ده بيتقرا من ملصق على حيطة وبيتكتب بالإيد في خانة، فالحروف اللي شكلها متشابه بتولّد
 * أكواد غلط وإسناد ضايع. نفس القاعدة المطبّقة فعلاً في `users.referral_code`.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const CODE_LENGTH = 6;

/** طول أقصى للـ`User-Agent` قبل الفحص — بيمنع نص ضخم يتفحص بلا داعي. */
const USER_AGENT_SCAN_LIMIT = 512;

export interface MarketingChannelRow {
  channel: MarketingChannel | 'unattributed';
  sources: number;
  hits: number;
  signups: number;
  orders: number;
  completed_orders: number;
  gross_revenue_cents: number;
  platform_revenue_cents: number;
  spend_cents: number;
  /** تكلفة اكتساب العميل — الصرف ÷ العملاء اللي عملوا طلب مكتمل. `null` لو مفيش مقام. */
  cac_cents: number | null;
  /** متوسط قيمة الطلب المكتمل. `null` لو مفيش طلبات مكتملة. */
  average_order_cents: number | null;
}

export interface MarketingSourceRow extends Omit<MarketingChannelRow, 'channel' | 'sources'> {
  source_id: string;
  code: string;
  name_ar: string;
  channel: MarketingChannel;
  region_label: string | null;
  is_active: boolean;
  accrued_commission_cents: number;
}

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(MarketingSource) private readonly sources: Repository<MarketingSource>,
    @InjectRepository(MarketingLinkHit) private readonly hits: Repository<MarketingLinkHit>,
    @InjectRepository(MarketingAttribution) private readonly attributions: Repository<MarketingAttribution>,
    @InjectRepository(MarketingSourceCommission) private readonly commissions: Repository<MarketingSourceCommission>,
    private readonly settings: SettingsService,
  ) {}

  // ═══════════════ المصادر ═══════════════

  /**
   * كود قصير فريد. بيحاول عدد محدود من المرات بدل حلقة مفتوحة: الفشل الصريح أوضح من طلب
   * بيفضل شغّال على القاعدة لثواني.
   */
  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const existing = await this.sources.findOne({ where: { code } });
      if (!existing) return code;
    }
    throw new ApiException(
      ErrorCode.SYS_001,
      'مقدرناش نولّد كود جديد دلوقتي — جرّب تاني',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  async createSource(input: {
    nameAr: string;
    channel: MarketingChannel;
    code?: string;
    regionLabel?: string | null;
    notes?: string | null;
    payoutPerCompletedOrderCents?: number;
    payoutContactName?: string | null;
    payoutContactPhone?: string | null;
    createdByUserId: string;
  }): Promise<MarketingSource> {
    const code = input.code?.trim().toUpperCase() || (await this.generateUniqueCode());
    // الكود بيتطبع ويتوزّع، فالتصادم لازم يترفض بوضوح مش يتقبل بصمت ويكسر الإسناد لمصدرين.
    const clash = await this.sources.findOne({ where: { code } });
    if (clash) {
      throw new ApiException(ErrorCode.VAL_001, 'الكود ده مستخدم بالفعل لمصدر تاني', HttpStatus.CONFLICT);
    }
    return this.sources.save(
      this.sources.create({
        code,
        nameAr: input.nameAr.trim(),
        channel: input.channel,
        regionLabel: input.regionLabel?.trim() || null,
        notes: input.notes?.trim() || null,
        payoutPerCompletedOrderCents: input.payoutPerCompletedOrderCents ?? 0,
        payoutContactName: input.payoutContactName?.trim() || null,
        payoutContactPhone: input.payoutContactPhone?.trim() || null,
        createdByUserId: input.createdByUserId,
        isActive: true,
      }),
    );
  }

  async updateSource(
    id: string,
    patch: Partial<
      Pick<
        MarketingSource,
        | 'nameAr'
        | 'channel'
        | 'regionLabel'
        | 'notes'
        | 'isActive'
        | 'payoutPerCompletedOrderCents'
        | 'payoutContactName'
        | 'payoutContactPhone'
      >
    >,
  ): Promise<MarketingSource> {
    const source = await this.sources.findOne({ where: { id } });
    if (!source) throw new ApiException(ErrorCode.VAL_001, 'المصدر ده مش موجود', HttpStatus.NOT_FOUND);
    // **الكود مش في القايمة عن قصد**: هو مطبوع على ملصقات برّه، فتغييره بيقطع كل الأكواد
    // الموزّعة بلا أي إنذار. لو الحملة اتغيّرت، المسار الصح مصدر جديد.
    Object.assign(source, patch);
    return this.sources.save(source);
  }

  listSources(): Promise<MarketingSource[]> {
    return this.sources.find({ where: { deletedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }

  async findActiveByCode(code: string): Promise<MarketingSource | null> {
    const normalized = code?.trim().toUpperCase();
    if (!normalized) return null;
    return this.sources.findOne({ where: { code: normalized, isActive: true, deletedAt: IsNull() } });
  }

  // ═══════════════ الرابط الذكي ═══════════════

  /**
   * المنصة من `User-Agent`. فحص نصّي بسيط عن قصد — مش محتاجين مكتبة كاملة عشان تلات حالات،
   * وأسوأ نتيجة لخطأ هنا إن الزائر يروح لصفحة الويب اللي بتشتغل على أي جهاز.
   */
  detectPlatform(userAgent: string | undefined): MarketingHitPlatform {
    const ua = (userAgent ?? '').slice(0, USER_AGENT_SCAN_LIMIT).toLowerCase();
    if (!ua) return 'other';
    if (ua.includes('android')) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/mozilla|chrome|safari|firefox|edg\//.test(ua)) return 'web';
    return 'other';
  }

  /**
   * وجهة التحويل لزائر الرابط.
   *
   * **الترتيب مقصود**: رابط المتجر للمنصة → صفحة الهبوط → عنوان تطبيق الويب من البيئة. يعني
   * لو الأدمن لسه ما دخّلش رابط المتجر، الزائر بيروح لحتة **شغّالة** مش لصفحة مكسورة — وده
   * الوضع الطبيعي قبل ما التطبيق ينزل المتاجر أصلاً.
   */
  async resolveDestination(platform: MarketingHitPlatform, code: string): Promise<string> {
    const [android, ios, landing] = await Promise.all([
      this.settings.getString('marketing.android_store_url', ''),
      this.settings.getString('marketing.ios_store_url', ''),
      this.settings.getString('marketing.web_landing_url', ''),
    ]);
    const fallback = landing.trim() || process.env.CUSTOMER_WEB_URL || process.env.WEB_APP_URL || '/';
    const storeUrl = platform === 'android' ? android.trim() : platform === 'ios' ? ios.trim() : '';
    const target = storeUrl || fallback;
    return appendMarketingCode(target, code);
  }

  /**
   * تسجيل زيارة — **مابيرميش أبدًا**. الزائر لازم يوصل لوجهته حتى لو التسجيل فشل؛ إحصائية
   * ضايعة أهون بما لا يقاس من عميل محتمل بيشوف صفحة خطأ.
   */
  async recordHit(sourceId: string, platform: MarketingHitPlatform): Promise<void> {
    try {
      await this.hits.insert({ sourceId, platform });
    } catch (err) {
      this.logger.warn(`فشل تسجيل زيارة رابط تسويق ${sourceId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ═══════════════ الإسناد ═══════════════

  /**
   * إسناد مستخدم لمصدر — **أول لمسة بتكسب، ومابيرميش أبدًا**.
   *
   * بيتنادى من مسار التسجيل. كود غلط أو مصدر موقوف أو المستخدم مُسنَد قبل كده = تجاهل بهدوء.
   * نفس سياسة `technician_referral_code` بالحرف، وعكس `referral_code` اللي بيرفض التسجيل:
   * خسارة إسناد أهون بما لا يقاس من عميل مقدرش يسجّل.
   *
   * بيرجّع `true` لو الإسناد اتعمل فعلاً — عشان اللي بينادي يقدر يقرر (زي إرسال رسالة ترحيب).
   */
  async attributeUser(userId: string, code: string | undefined): Promise<boolean> {
    if (!code?.trim()) return false;
    try {
      const source = await this.findActiveByCode(code);
      if (!source) return false;
      // `ON CONFLICT DO NOTHING` مش `findOne` قبل الإدخال: تسجيلين متزامنين بكودين مختلفين
      // لازم القاعدة هي اللي تفصل بينهم، مش فحص-ثم-كتابة فيه فجوة سباق.
      const result = await this.attributions
        .createQueryBuilder()
        .insert()
        .values({ userId, sourceId: source.id })
        .orIgnore()
        .execute();
      return (result.identifiers?.[0]?.id ?? null) !== null;
    } catch (err) {
      this.logger.warn(`فشل إسناد المستخدم ${userId} لكود ${code}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  // ═══════════════ مستحقات المصدر ═══════════════

  /**
   * احتساب مستحق للمصدر لما طلب عميله يتم.
   *
   * **أول طلب مكتمل بس** — العميل الواحد بيتكافأ عليه مرة واحدة، غير كده البواب اللي عنده
   * عميل بيطلب كل أسبوع بياخد عمولة أبدية على اكتساب حصل مرة واحدة.
   *
   * `UNIQUE(order_id)` في القاعدة هو حارس التكرار: الحدث ممكن يوصل مرتين (نسختين، إعادة
   * تشغيل)، والإدخال التاني بيتجاهل بدل ما يولّد مستحق مضاعف.
   */
  async accrueCommissionForOrder(orderId: string): Promise<void> {
    const rows = await this.dataSource.query<
      { source_id: string; customer_user_id: string; amount_cents: number }[]
    >(
      `SELECT s.id AS source_id,
              a.user_id AS customer_user_id,
              s.payout_per_completed_order_cents AS amount_cents
         FROM orders o
         -- **orders.customer_id بيشاور على customer_profiles.id مش على users.id**.
         -- الربط المباشر بـ a.user_id كان بيدّي صفر صفوف دايمًا — كل الأرقام تطلع صفر
         -- والنظام يبان «شغّال» وهو مش بيسند حاجة. اتلقطت في التدقيق الحي (م-٥/ب، م-٦/أ).
         JOIN customer_profiles cp ON cp.id = o.customer_id
         JOIN marketing_attributions a ON a.user_id = cp.user_id AND a.deleted_at IS NULL
         JOIN marketing_sources s ON s.id = a.source_id AND s.deleted_at IS NULL
        WHERE o.id = $1
          AND s.payout_per_completed_order_cents > 0
          -- أول طلب مكتمل للعميل ده تحت المصدر ده بس
          AND NOT EXISTS (
                SELECT 1 FROM marketing_source_commissions c
                 WHERE c.customer_user_id = a.user_id
                   AND c.status <> 'cancelled'
                   AND c.deleted_at IS NULL)`,
      [orderId],
    );
    const row = rows[0];
    if (!row) return;
    await this.commissions
      .createQueryBuilder()
      .insert()
      .values({
        sourceId: row.source_id,
        orderId,
        customerUserId: row.customer_user_id,
        amountCents: Number(row.amount_cents),
      })
      .orIgnore()
      .execute();
  }

  /** إلغاء مستحق لطلب رجع/اتلغى — الشغلانة ما تمّتش، فالعمولة مالهاش أساس. */
  async cancelCommissionForOrder(orderId: string): Promise<void> {
    await this.commissions.update({ orderId, status: 'accrued' }, { status: 'cancelled' });
  }

  async markCommissionsPaid(ids: string[], adminUserId: string, note?: string): Promise<number> {
    if (!ids.length) return 0;
    const result = await this.dataSource.query<unknown[]>(
      `UPDATE marketing_source_commissions
          SET status = 'paid', paid_at = now(), paid_by_user_id = $2, payment_note = $3, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'accrued' AND deleted_at IS NULL
        RETURNING id`,
      [ids, adminUserId, note ?? null],
    );
    return result.length;
  }

  listCommissions(sourceId?: string, status?: string): Promise<MarketingSourceCommission[]> {
    const where: Record<string, unknown> = { deletedAt: IsNull() };
    if (sourceId) where.sourceId = sourceId;
    if (status) where.status = status;
    return this.commissions.find({ where, order: { accruedAt: 'DESC' }, take: 500 });
  }

  // ═══════════════ التقرير ═══════════════

  /**
   * أرقام كل مصدر في فترة — الرد المباشر على «أزوّد في الإعلان ده ولا لأ».
   *
   * ## ليه المدى بيتطبّق على حاجتين مختلفتين
   *
   * **الزيارات** بتتفلتر بوقتها، لكن **الطلبات** بتتفلتر بوقتها هي كمان — مش بوقت الإسناد.
   * يعني عميل جه من ملصق الشهر اللي فات وطلب الشهر ده، طلبه بيتحسب على الملصق في الشهر ده.
   * ده اللي بيخلّي «الملصق ده جابلي كام فلوس الشهر ده» سؤال ليه إجابة، وهو السؤال اللي
   * الميزانية بتتقرر عليه.
   *
   * **الـCAC مايتخزنش**: بيتحسب من `marketing_spend` (مُدخل من الأدمن) ÷ عملاء الفترة. أي رقم
   * محسوب بيتخزن بيتعتّق ويكذب أول ما البيانات تتغيّر — الدرس المكلف من `total_orders_count`.
   */
  async sourcePerformance(from: Date, to: Date): Promise<MarketingSourceRow[]> {
    const rows = await this.dataSource.query<
      Record<string, string | boolean | null>[]
    >(
      `WITH hit_counts AS (
         SELECT source_id, COUNT(*)::int AS hits
           FROM marketing_link_hits
          WHERE occurred_at >= $1 AND occurred_at < $2
          GROUP BY source_id
       ),
       signup_counts AS (
         SELECT source_id, COUNT(*)::int AS signups
           FROM marketing_attributions
          WHERE deleted_at IS NULL AND attributed_at >= $1 AND attributed_at < $2
          GROUP BY source_id
       ),
       order_stats AS (
         SELECT a.source_id,
                COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE o.order_status = 'completed')::int AS completed_orders,
                COALESCE(SUM(o.total_amount_cents) FILTER (WHERE o.order_status = 'completed'), 0)::bigint AS gross_revenue_cents,
                COALESCE(SUM(o.platform_commission_cents) FILTER (WHERE o.order_status = 'completed'), 0)::bigint AS platform_revenue_cents,
                COUNT(DISTINCT o.customer_id) FILTER (WHERE o.order_status = 'completed')::int AS converting_customers
           FROM orders o
           -- نفس السبب فوق: customer_id بروفايل مش مستخدم.
           JOIN customer_profiles cp ON cp.id = o.customer_id
           JOIN marketing_attributions a ON a.user_id = cp.user_id AND a.deleted_at IS NULL
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.deleted_at IS NULL
          GROUP BY a.source_id
       ),
       accrued AS (
         SELECT source_id, COALESCE(SUM(amount_cents), 0)::bigint AS accrued_commission_cents
           FROM marketing_source_commissions
          WHERE status = 'accrued' AND deleted_at IS NULL
          GROUP BY source_id
       )
       SELECT s.id AS source_id, s.code, s.name_ar, s.channel, s.region_label, s.is_active,
              COALESCE(h.hits, 0) AS hits,
              COALESCE(g.signups, 0) AS signups,
              COALESCE(o.orders, 0) AS orders,
              COALESCE(o.completed_orders, 0) AS completed_orders,
              COALESCE(o.gross_revenue_cents, 0) AS gross_revenue_cents,
              COALESCE(o.platform_revenue_cents, 0) AS platform_revenue_cents,
              COALESCE(o.converting_customers, 0) AS converting_customers,
              COALESCE(c.accrued_commission_cents, 0) AS accrued_commission_cents
         FROM marketing_sources s
         LEFT JOIN hit_counts h ON h.source_id = s.id
         LEFT JOIN signup_counts g ON g.source_id = s.id
         LEFT JOIN order_stats o ON o.source_id = s.id
         LEFT JOIN accrued c ON c.source_id = s.id
        WHERE s.deleted_at IS NULL
        ORDER BY COALESCE(o.completed_orders, 0) DESC, COALESCE(h.hits, 0) DESC`,
      [from, to],
    );

    return rows.map((r) => {
      const completed = Number(r.completed_orders);
      const gross = Number(r.gross_revenue_cents);
      return {
        source_id: String(r.source_id),
        code: String(r.code),
        name_ar: String(r.name_ar),
        channel: r.channel as MarketingChannel,
        region_label: (r.region_label as string | null) ?? null,
        is_active: Boolean(r.is_active),
        hits: Number(r.hits),
        signups: Number(r.signups),
        orders: Number(r.orders),
        completed_orders: completed,
        gross_revenue_cents: gross,
        platform_revenue_cents: Number(r.platform_revenue_cents),
        // الصرف بيتسجّل بالقناة مش بالمصدر، فمفيش رقم صرف على مستوى المصدر — و«صفر» هنا
        // كان هيكذب. الـCAC على مستوى المصدر بيفضل `null` عن قصد، وبيتحسب على القناة تحت.
        spend_cents: 0,
        cac_cents: null,
        average_order_cents: completed > 0 ? Math.round(gross / completed) : null,
        accrued_commission_cents: Number(r.accrued_commission_cents),
      };
    });
  }

  /**
   * نفس الأرقام مجمّعة بالقناة، **زائد الصرف والـCAC** — لأن `marketing_spend` بيتسجّل بالقناة
   * والشهر، مش بالمصدر. ده المستوى اللي المقارنة بين «بوستر ولا إنفلونسر» بتتم عنده.
   */
  async channelPerformance(from: Date, to: Date): Promise<MarketingChannelRow[]> {
    const perSource = await this.sourcePerformance(from, to);
    const converting = await this.dataSource.query<{ channel: string; customers: string }[]>(
      `SELECT s.channel, COUNT(DISTINCT o.customer_id) AS customers
         FROM orders o
         JOIN customer_profiles cp ON cp.id = o.customer_id
         JOIN marketing_attributions a ON a.user_id = cp.user_id AND a.deleted_at IS NULL
         JOIN marketing_sources s ON s.id = a.source_id AND s.deleted_at IS NULL
        WHERE o.order_status = 'completed' AND o.deleted_at IS NULL
          AND o.created_at >= $1 AND o.created_at < $2
        GROUP BY s.channel`,
      [from, to],
    );
    const convertingByChannel = new Map(converting.map((r) => [r.channel, Number(r.customers)]));

    const spendRows = await this.dataSource.query<{ channel: string; spend: string }[]>(
      // الصرف شهري، فبنقارن بداية الشهر — صف شهر يدخل لو الشهر ده متقاطع مع المدى المطلوب.
      `SELECT channel, COALESCE(SUM(amount_cents), 0) AS spend
         FROM marketing_spend
        WHERE deleted_at IS NULL AND month >= date_trunc('month', $1::date) AND month < $2::date
        GROUP BY channel`,
      [from, to],
    );
    const spendByChannel = new Map(spendRows.map((r) => [r.channel, Number(r.spend)]));

    const byChannel = new Map<string, MarketingChannelRow>();
    for (const row of perSource) {
      const current = byChannel.get(row.channel) ?? {
        channel: row.channel,
        sources: 0,
        hits: 0,
        signups: 0,
        orders: 0,
        completed_orders: 0,
        gross_revenue_cents: 0,
        platform_revenue_cents: 0,
        spend_cents: 0,
        cac_cents: null,
        average_order_cents: null,
      };
      current.sources += 1;
      current.hits += row.hits;
      current.signups += row.signups;
      current.orders += row.orders;
      current.completed_orders += row.completed_orders;
      current.gross_revenue_cents += row.gross_revenue_cents;
      current.platform_revenue_cents += row.platform_revenue_cents;
      byChannel.set(row.channel, current);
    }

    for (const [channel, row] of byChannel) {
      row.spend_cents = spendByChannel.get(channel) ?? 0;
      const customers = convertingByChannel.get(channel) ?? 0;
      // **مقام صفر = `null` مش صفر**: «CAC صفر» بيتقري كأن الاكتساب ببلاش، والحقيقة إننا
      // ماكتسبناش حد بالمرة. نفس مبدأ `KpiValue.value` في ADR-0081.
      row.cac_cents = customers > 0 && row.spend_cents > 0 ? Math.round(row.spend_cents / customers) : null;
      row.average_order_cents =
        row.completed_orders > 0 ? Math.round(row.gross_revenue_cents / row.completed_orders) : null;
    }

    return [...byChannel.values()].sort((a, b) => b.completed_orders - a.completed_orders);
  }
}

/**
 * بيضيف `?m=<code>` للوجهة.
 *
 * الكود بيفضل ماشي مع التحويل عشان صفحة الهبوط تعرف تكمّل الإسناد. متجر التطبيقات بيتجاهله
 * (وده متوقّع ومكتوب في ADR-0082: الإسناد بعد التثبيت بيعتمد على إدخال الكود يدويًا).
 */
export function appendMarketingCode(target: string, code: string): string {
  if (!target || target === '/') return `/?m=${encodeURIComponent(code)}`;
  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}m=${encodeURIComponent(code)}`;
}
