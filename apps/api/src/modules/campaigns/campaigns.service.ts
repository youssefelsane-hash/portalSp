import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { isWithinQuietHours } from '../notifications/quiet-hours.util';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderStatus } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { CustomerServiceIntent, IntentStage } from './entities/customer-service-intent.entity';
import { NotificationCampaign } from './entities/notification-campaign.entity';
import { NotificationCampaignSend } from './entities/notification-campaign-send.entity';
import { renderCampaignTemplate } from './campaign-template.util';

/** نوع الإشعار الموحّد لكل الحملات — الأدمن بيقدر يوجّه قنواته من محرك الإشعارات زي أي نوع تاني. */
export const CAMPAIGN_NOTIFICATION_TYPE = 'marketing_campaign';

/**
 * العميل "مشغول بطلب" = عنده طلب لسه شغال دلوقتي، فمش وقته إعلان.
 *
 * مُعرّفة بقيم `OrderStatus` مش نص خام في SQL: أي حالة جديدة تتضاف للـenum بتفضل ظاهرة هنا
 * كخيار صريح لازم حد ياخد قرار فيها، بدل ما تتسرّب بصمت لقايمة نصية قديمة.
 */
export const CUSTOMER_BUSY_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.TECHNICIAN_ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
  OrderStatus.WORK_COMPLETED,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
  OrderStatus.DISPUTED,
];

interface PromoCandidate {
  user_id: string;
  full_name: string;
  service_id: string;
  service_name: string;
  category_name: string;
}

interface IntentCandidate {
  intent_id: string;
  user_id: string;
  full_name: string;
  service_id: string;
  service_name: string;
  category_name: string;
  category_id: string;
}

/**
 * محرك حملات التسويق ودورة حياة العميل (ADR-0046).
 *
 * **معزول عمدًا**: بيستهلك `NotificationsService` من برّه زي أي مستهلك تاني، ومش بيلمس ولا سطر
 * في orders/matching/payments. أسوأ فشل ممكن هنا هو إن إعلان ما اتبعتش — مستحيل يعطّل حجز حقيقي.
 *
 * كل الحواجز (سقف أسبوعي، cooldown، ساعات هدوء، إلغاء اشتراك، استبعاد العميل المشغول/الميت)
 * مفاتيح إعداد مش أرقام مدفونة — راجع migration 0207.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(NotificationCampaign) private readonly campaigns: Repository<NotificationCampaign>,
    @InjectRepository(NotificationCampaignSend) private readonly sends: Repository<NotificationCampaignSend>,
    @InjectRepository(CustomerServiceIntent) private readonly intents: Repository<CustomerServiceIntent>,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── تسجيل الاهتمام (من تطبيق العميل) ─────────────────────────────────────

  /**
   * العميل فتح صفحة خدمة أو بدأ حجز. **fire-and-forget من ناحية التطبيق**: أي فشل هنا ما
   * يأثرش على تصفح العميل خالص.
   */
  async recordIntent(userId: string, serviceId: string, stage: IntentStage): Promise<void> {
    await this.intents.save(this.intents.create({ userId, serviceId, intentStage: stage }));
  }

  // ── الدورة الرئيسية ───────────────────────────────────────────────────────

  /**
   * بترجّع عدد الإشعارات اللي اتبعتت فعلاً في الدورة دي.
   *
   * `options.userIds` — **نطاق اختياري للاختبارات بس**، نفس نمط
   * `RecurringOrdersService.sweep({ templateIds })` و`OrderAutoCancelService.sweep({ orderNumberPrefix })`.
   *
   * السبب: الدورة دي بتستهدف **كل** العملاء المؤهّلين في القاعدة — وده الصح في الإنتاج. لكن في
   * الاختبارات المتوازية بقت بتبعت حملات لمستخدمي specs تانية، وبتسيب صفوف في
   * `notification_campaign_sends` مربوطة بيهم — فتنظيف الـspec التاني بيفشل على مفتاح أجنبي
   * وبيسقط الـsuite كلها بلا أي تأكيد فاشل حقيقي.
   *
   * الإنتاج بينادي `sweep()` بلا معاملات فالسلوك مايتغيّرش بأي شكل.
   */
  async sweep(options?: { userIds?: string[] }): Promise<number> {
    if (!(await this.settings.getBoolean('campaigns.enabled', true))) return 0;

    // ساعات الهدوء بتتفحص مرة واحدة للدورة كلها — الوقت مابيتغيرش جوّه دورة واحدة، ومفيش داعي
    // نكرر الحساب لكل مرشّح.
    const now = new Date();
    const quietStart = await this.settings.getString('campaigns.quiet_hours_start', '21:00');
    const quietEnd = await this.settings.getString('campaigns.quiet_hours_end', '06:00');
    if (isWithinQuietHours(now, quietStart, quietEnd)) return 0;

    const batchSize = Math.min(1000, Math.max(1, Math.floor(await this.settings.getNumber('campaigns.sweep_batch_size', 200))));

    // الاسترجاع الأول: نية صريحة من عميل حقيقي أثمن بكتير من إعلان عشوائي، فبياخد نصيبه من
    // الدفعة الأول.
    const abandoned = await this.sweepAbandonedIntents(batchSize, options?.userIds);
    const promo = await this.sweepPeriodicPromos(Math.max(0, batchSize - abandoned), options?.userIds);

    await this.purgeOldIntents();
    return abandoned + promo;
  }

  // ── استرجاع الحجز المتروك ────────────────────────────────────────────────

  private async sweepAbandonedIntents(limit: number, userIds?: string[]): Promise<number> {
    if (limit <= 0) return 0;
    const campaigns = await this.activeCampaigns('abandoned_intent');
    if (campaigns.length === 0) return 0;

    const defaultDelay = Math.max(
      1,
      Math.floor(await this.settings.getNumber('campaigns.abandoned_intent_delay_minutes', 60)),
    );
    // أقصر تأخير بين الحملات هو اللي بيحدد مين مؤهل للسحب — الاختيار الدقيق لكل مرشّح تحت.
    const minDelay = Math.min(defaultDelay, ...campaigns.map((c) => c.triggerDelayMinutes ?? defaultDelay));

    const rows = await this.dataSource.query<IntentCandidate[]>(
      `
      SELECT i.id AS intent_id, i.user_id, u.full_name, s.id AS service_id, s.name_ar AS service_name,
             sc.name_ar AS category_name, sc.id AS category_id
        FROM customer_service_intents i
        JOIN users u ON u.id = i.user_id
        JOIN customer_profiles cp ON cp.user_id = u.id
        JOIN services s ON s.id = i.service_id
        JOIN service_categories sc ON sc.id = s.category_id
       WHERE i.processed_at IS NULL
         AND ($3::uuid[] IS NULL OR i.user_id = ANY($3::uuid[]))
         AND i.occurred_at <= now() - make_interval(mins => $1::int)
         AND u.is_blocked = false AND u.is_active = true AND u.deleted_at IS NULL
         AND cp.marketing_opt_out = false
         AND s.is_active = true AND s.deleted_at IS NULL
         -- الخدمة لازم تكون مسموح الإعلان عنها (ADR-0046 §3) — حتى في الاسترجاع: لو الخدمة
         -- مش جاهزة، تذكير العميل بيها بيضر أكتر ما بينفع.
         AND s.is_promotable = true
         -- **الأهم**: لو العميل حجز الخدمة دي فعلاً بعد ما بصّ عليها، مفيش أي داعي نذكّره.
         AND NOT EXISTS (
           SELECT 1 FROM orders o
            WHERE o.customer_id = cp.id AND o.service_id = i.service_id
              AND o.created_at >= i.occurred_at AND o.deleted_at IS NULL
         )
       ORDER BY i.occurred_at ASC
       LIMIT $2
      `,
      [minDelay, limit, userIds ?? null],
    );

    let sent = 0;
    for (const row of rows) {
      const campaign =
        campaigns.find((c) => c.categoryId === row.category_id) ?? campaigns.find((c) => c.categoryId === null);
      if (!campaign) {
        await this.markIntentProcessed(row.intent_id);
        continue;
      }

      // كل حملة ممكن يكون ليها تأخير خاص — الاستعلام فوق سحب بأقصر تأخير، فبنتأكد هنا.
      const delay = campaign.triggerDelayMinutes ?? defaultDelay;
      const eligibleAt = Date.now() - delay * 60_000;
      const [{ occurred_at: occurredAt }] = await this.dataSource.query<{ occurred_at: Date }[]>(
        `SELECT occurred_at FROM customer_service_intents WHERE id = $1`,
        [row.intent_id],
      );
      if (new Date(occurredAt).getTime() > eligibleAt) continue; // لسه بدري على الحملة دي

      const delivered = await this.trySend(campaign, {
        userId: row.user_id,
        serviceId: row.service_id,
        serviceName: row.service_name,
        categoryName: row.category_name,
        customerName: row.full_name,
      });
      // بيتعلّم "اتعالج" في الحالتين — سواء اتبعت أو اتمنع بحاجز. من غير كده الاهتمام المرفوض
      // بيتحاول عليه كل دورة للأبد.
      await this.markIntentProcessed(row.intent_id);
      if (delivered) sent += 1;
    }
    return sent;
  }

  // ── الإعلان الدوري ────────────────────────────────────────────────────────

  private async sweepPeriodicPromos(limit: number, userIds?: string[]): Promise<number> {
    if (limit <= 0) return 0;
    const campaigns = await this.activeCampaigns('periodic_promo');
    if (campaigns.length === 0) return 0;

    const intervalDays = Math.max(1, Math.floor(await this.settings.getNumber('campaigns.periodic_interval_days', 4)));
    const inactiveDays = Math.max(1, Math.floor(await this.settings.getNumber('campaigns.inactive_customer_days', 90)));

    // اختيار عشوائي حقيقي للخدمة لكل عميل (DISTINCT ON + random) — «يختار خدمة عشوائي» بالحرف.
    // العشوائية على مستوى **العميل** مش على مستوى الدفعة: كل عميل بياخد خدمة مختلفة في نفس
    // الدورة، وبيشوف خدمة مختلفة كل مرة.
    const rows = await this.dataSource.query<PromoCandidate[]>(
      `
      WITH eligible_customers AS (
        SELECT u.id AS user_id, u.full_name, cp.id AS customer_profile_id
          FROM users u
          JOIN customer_profiles cp ON cp.user_id = u.id
         WHERE u.user_type = 'customer'
           AND ($5::uuid[] IS NULL OR u.id = ANY($5::uuid[]))
           AND u.is_blocked = false AND u.is_active = true AND u.deleted_at IS NULL
           AND cp.marketing_opt_out = false
           -- حساب ميت: الإرسال ليه بيضر سمعة المُرسِل (وبيرفع bounce rate عند FCM).
           AND COALESCE(u.last_login_at, u.created_at) >= now() - make_interval(days => $1::int)
           -- العميل المشغول بطلب شغال دلوقتي مش وقته إعلان.
           AND NOT EXISTS (
             SELECT 1 FROM orders o
              WHERE o.customer_id = cp.id AND o.deleted_at IS NULL
                AND o.order_status = ANY($4::order_status[])
           )
           -- الفاصل الدوري العام: العميل خد إعلان قريّب؟ استنى.
           AND NOT EXISTS (
             SELECT 1 FROM notification_campaign_sends cs
              WHERE cs.user_id = u.id AND cs.sent_at >= now() - make_interval(days => $2::int)
           )
      ),
      promotable AS (
        SELECT s.id AS service_id, s.name_ar AS service_name, sc.name_ar AS category_name
          FROM services s
          JOIN service_categories sc ON sc.id = s.category_id
         WHERE s.is_promotable = true AND s.is_active = true AND s.deleted_at IS NULL
           AND sc.is_active = true AND sc.deleted_at IS NULL
      )
      SELECT DISTINCT ON (ec.user_id)
             ec.user_id, ec.full_name, p.service_id, p.service_name, p.category_name
        FROM eligible_customers ec
        CROSS JOIN promotable p
       ORDER BY ec.user_id, random()
       LIMIT $3
      `,
      [inactiveDays, intervalDays, limit, CUSTOMER_BUSY_ORDER_STATUSES, userIds ?? null],
    );

    let sent = 0;
    for (const row of rows) {
      // اختيار الحملة عشوائي بين المؤهلات (مش الأعلى أولوية دايمًا) — وإلا كل العملاء بياخدوا
      // نفس النص للأبد. الأولوية بتفضل مؤثرة كوزن عبر الترتيب في `activeCampaigns`.
      const campaign = this.pickWeightedCampaign(campaigns);
      const delivered = await this.trySend(campaign, {
        userId: row.user_id,
        serviceId: row.service_id,
        serviceName: row.service_name,
        categoryName: row.category_name,
        customerName: row.full_name,
      });
      if (delivered) sent += 1;
    }
    return sent;
  }

  /** اختيار مرجّح بالأولوية — الحملة الأعلى أولوية بتظهر أكتر، بس مش دايمًا. */
  private pickWeightedCampaign(campaigns: NotificationCampaign[]): NotificationCampaign {
    const total = campaigns.reduce((sum, c) => sum + Math.max(1, c.priority), 0);
    let ticket = Math.random() * total;
    for (const campaign of campaigns) {
      ticket -= Math.max(1, campaign.priority);
      if (ticket <= 0) return campaign;
    }
    return campaigns[campaigns.length - 1];
  }

  // ── الإرسال + الحواجز ─────────────────────────────────────────────────────

  /**
   * بيطبّق الحواجز وبيبعت. بيرجّع `false` لو اتمنع بحاجز أو فشل الإرسال — **من غير ما يرمي**:
   * فشل إعلان واحد ما ينفعش يوقّف الدورة كلها.
   */
  private async trySend(
    campaign: NotificationCampaign,
    target: { userId: string; serviceId: string; serviceName: string; categoryName: string; customerName: string },
  ): Promise<boolean> {
    try {
      if (!(await this.passesFrequencyCaps(campaign, target.userId))) return false;

      const variables = {
        service_name: target.serviceName,
        category_name: target.categoryName,
        customer_name: target.customerName,
      };
      const title = renderCampaignTemplate(campaign.titleTemplateAr, variables);
      const body = renderCampaignTemplate(campaign.bodyTemplateAr, variables);
      if (!title || !body) {
        this.logger.warn(`حملة ${campaign.id} قالبها بيطلّع نص فاضي بعد ملء المتغيّرات — اتخطّت`);
        return false;
      }

      // **السجل قبل الإرسال** عمدًا: لو الإرسال فشل بعد ما اتسجّل، أسوأ نتيجة إن العميل ما ياخدش
      // إعلان. العكس (إرسال بلا سجل) معناه إن الحواجز مش شايفاه ⇒ ممكن يتبعتله تاني فورًا.
      await this.sends.save(
        this.sends.create({ campaignId: campaign.id, userId: target.userId, serviceId: target.serviceId }),
      );

      await this.notifications.notify({
        userId: target.userId,
        notificationType: CAMPAIGN_NOTIFICATION_TYPE,
        titleAr: title,
        bodyAr: body,
        deepLink: `/services/${target.serviceId}`,
        referenceType: 'notification_campaign',
        referenceId: campaign.id,
      });
      return true;
    } catch (err) {
      this.logger.warn(`فشل إرسال حملة ${campaign.id} للمستخدم ${target.userId}: ${String(err)}`);
      return false;
    }
  }

  /** السقف الأسبوعي العام + cooldown الحملة نفسها (ADR-0046 §6). */
  private async passesFrequencyCaps(campaign: NotificationCampaign, userId: string): Promise<boolean> {
    const weeklyCap = Math.max(0, Math.floor(await this.settings.getNumber('campaigns.max_per_customer_per_week', 2)));
    if (weeklyCap === 0) return false;

    const [caps] = await this.dataSource.query<{ weekly_count: string; last_from_campaign: Date | null }[]>(
      `SELECT COUNT(*) FILTER (WHERE sent_at >= now() - interval '7 days') AS weekly_count,
              MAX(sent_at) FILTER (WHERE campaign_id = $2) AS last_from_campaign
         FROM notification_campaign_sends
        WHERE user_id = $1`,
      [userId, campaign.id],
    );

    // السقف الأسبوعي فوق كل الحملات مجتمعة — أهم حاجز: مهما فعّل الأدمن حملات، ده بيحكمهم كلهم.
    if (Number(caps.weekly_count) >= weeklyCap) return false;

    if (caps.last_from_campaign) {
      const cooldownMs = campaign.cooldownDays * 24 * 60 * 60 * 1000;
      if (Date.now() - new Date(caps.last_from_campaign).getTime() < cooldownMs) return false;
    }
    return true;
  }

  private async activeCampaigns(type: NotificationCampaign['campaignType']): Promise<NotificationCampaign[]> {
    return this.campaigns.find({
      where: { campaignType: type, isActive: true, deletedAt: IsNull() },
      order: { priority: 'DESC' },
    });
  }

  private async markIntentProcessed(intentId: string): Promise<void> {
    await this.intents.update({ id: intentId }, { processedAt: new Date() });
  }

  /**
   * الاهتمامات إشارة عابرة مش سجل دائم لسلوك العميل — بتتشال بعد 30 يوم. الحد ثابت هنا مش
   * إعداد: ده قرار خصوصية مش قرار تشغيلي.
   */
  private async purgeOldIntents(): Promise<void> {
    try {
      await this.dataSource.query(`DELETE FROM customer_service_intents WHERE occurred_at < now() - interval '30 days'`);
    } catch (err) {
      this.logger.warn(`فشل تنضيف اهتمامات قديمة: ${String(err)}`);
    }
  }
}
