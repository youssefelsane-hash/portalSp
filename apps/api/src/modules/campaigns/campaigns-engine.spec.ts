import { DataSource } from 'typeorm';
import { CampaignsService } from './campaigns.service';
import { renderCampaignTemplate, unknownTemplateVariables } from './campaign-template.util';
import { CustomerServiceIntent } from './entities/customer-service-intent.entity';
import { NotificationCampaign } from './entities/notification-campaign.entity';
import { NotificationCampaignSend } from './entities/notification-campaign-send.entity';

// ADR-0046 / docs/08 §74-أ — محرك حملات التسويق. الاختبارات على Postgres حقيقي عشان استعلامات
// اختيار الجمهور نفسها تتفحص (هي اللي فيها كل الحواجز)، مش منطق TypeScript فوقها بس.
describe('CampaignsService — محرك الحملات (ADR-0046)', () => {
  let dataSource: DataSource;
  let service: CampaignsService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    servicePromotable: '',
    serviceNotPromotable: '',
    customerUser: '',
    customerProfile: '',
    optedOutUser: '',
    optedOutProfile: '',
    address: '',
    campaignPromo: '',
    campaignIntent: '',
  };
  const settingsValues = new Map<string, unknown>();
  const sentNotifications: { userId: string; titleAr: string; bodyAr: string }[] = [];
  const originalCampaignStates: Array<{ id: string; is_active: boolean }> = [];

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function insertCustomer(label: string): Promise<{ userId: string; profileId: string }> {
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at, last_login_at)
       VALUES ($1,$2,'customer', now(), now()) RETURNING id`,
      [`+2017${label}${runId}`.slice(0, 15), `عميل حملات ${label}`],
    );
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [user.id]);
    return { userId: user.id, profileId: profile.id };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [NotificationCampaign, NotificationCampaignSend, CustomerServiceIntent],
    });
    await dataSource.initialize();

    // بقايا تشغيلات سابقة فشل تنضيفها: الاختيار العشوائي للخدمة بيمسح **كل** الخدمات
    // القابلة للإعلان، فخدمة قديمة من تشغيلة سابقة بتخلي النتيجة غير حتمية.
    await q(`DELETE FROM services WHERE slug LIKE 'campaign-svc-%'`);
    await q(`DELETE FROM service_categories WHERE slug LIKE 'campaign-cat-%'`);

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة حملات ${runId}`, `Campaign City ${runId}`, `campaign-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق حملات ${runId}`,
      `Campaign Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة حملات ${runId}`, `Campaign Cat ${runId}`, `campaign-cat-${runId}`],
    );
    ids.category = category.id;

    const [promotable] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, is_active, is_promotable)
       VALUES ($1,$2,$3,$4,'formula',30000,true,true) RETURNING id`,
      [ids.category, `تسليك مواسير ${runId}`, `Pipe ${runId}`, `campaign-svc-a-${runId}`],
    );
    ids.servicePromotable = promotable.id;
    const [notPromotable] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, is_active, is_promotable)
       VALUES ($1,$2,$3,$4,'formula',30000,true,false) RETURNING id`,
      [ids.category, `خدمة مش جاهزة ${runId}`, `NotReady ${runId}`, `campaign-svc-b-${runId}`],
    );
    ids.serviceNotPromotable = notPromotable.id;

    const customer = await insertCustomer('a');
    ids.customerUser = customer.userId;
    ids.customerProfile = customer.profileId;
    const optedOut = await insertCustomer('b');
    ids.optedOutUser = optedOut.userId;
    ids.optedOutProfile = optedOut.profileId;
    await q(`UPDATE customer_profiles SET marketing_opt_out = true WHERE id = $1`, [ids.optedOutProfile]);

    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.2,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع حملات ${runId}`],
    );
    ids.address = address.id;

    // حملات خاصة بالاختبار — مستقلة عن المزروعة في migration 0207 عشان النتايج تبقى حتمية.
    // بنحفظ الحالة الأصلية بدل ما نفعّل كل الحملات عمياني في التنظيف؛ الاختبار لازم ما يغيّرش
    // قرار أدمن موجود في قاعدة التطوير المحلية.
    originalCampaignStates.push(
      ...(await q(`SELECT id, is_active FROM notification_campaigns WHERE deleted_at IS NULL`)),
    );
    await q(`UPDATE notification_campaigns SET is_active = false WHERE deleted_at IS NULL`);
    const [promo] = await q(
      `INSERT INTO notification_campaigns (campaign_type, name, title_template_ar, body_template_ar, cooldown_days, priority)
       VALUES ('periodic_promo',$1,'محتاج {{service_name}}؟','فنيينا موجودين لـ{{service_name}} في {{category_name}}.',4,100) RETURNING id`,
      [`اختبار دوري ${runId}`],
    );
    ids.campaignPromo = promo.id;
    const [intent] = await q(
      `INSERT INTO notification_campaigns (campaign_type, name, title_template_ar, body_template_ar, cooldown_days, priority, trigger_delay_minutes)
       VALUES ('abandoned_intent',$1,'لسه فاكر {{service_name}}؟','الخدمة لسه موجودة يا {{customer_name}}.',2,200,60) RETURNING id`,
      [`اختبار استرجاع ${runId}`],
    );
    ids.campaignIntent = intent.id;

    settingsValues.set('campaigns.enabled', true);
    settingsValues.set('campaigns.max_per_customer_per_week', 2);
    settingsValues.set('campaigns.periodic_interval_days', 4);
    settingsValues.set('campaigns.abandoned_intent_delay_minutes', 60);
    // ساعات هدوء صفرية في الاختبار — نطاق صفري = مفيش هدوء (راجع quiet-hours.util)، عشان
    // النتيجة ما تعتمدش على الساعة اللي الاختبار بيشتغل فيها.
    settingsValues.set('campaigns.quiet_hours_start', '00:00');
    settingsValues.set('campaigns.quiet_hours_end', '00:00');
    settingsValues.set('campaigns.inactive_customer_days', 90);
    settingsValues.set('campaigns.sweep_batch_size', 200);

    const settingsStub = {
      getBoolean: async (key: string, fallback: boolean) => (settingsValues.get(key) as boolean) ?? fallback,
      getNumber: async (key: string, fallback: number) => (settingsValues.get(key) as number) ?? fallback,
      getString: async (key: string, fallback: string) => (settingsValues.get(key) as string) ?? fallback,
    };
    const notificationsStub = {
      notify: async (input: { userId: string; titleAr: string; bodyAr: string }) => {
        sentNotifications.push({ userId: input.userId, titleAr: input.titleAr, bodyAr: input.bodyAr });
        return {} as never;
      },
    };

    service = new CampaignsService(
      dataSource.getRepository(NotificationCampaign),
      dataSource.getRepository(NotificationCampaignSend),
      dataSource.getRepository(CustomerServiceIntent),
      dataSource,
      settingsStub as never,
      notificationsStub as never,
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM notification_campaign_sends WHERE campaign_id IN ($1,$2)`, [ids.campaignPromo, ids.campaignIntent]);
      await q(`DELETE FROM customer_service_intents WHERE user_id IN ($1,$2)`, [ids.customerUser, ids.optedOutUser]);
      await q(`DELETE FROM notification_campaigns WHERE id IN ($1,$2)`, [ids.campaignPromo, ids.campaignIntent]);
      await q(`DELETE FROM orders WHERE customer_id IN ($1,$2)`, [ids.customerProfile, ids.optedOutProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id IN ($1,$2)`, [ids.customerProfile, ids.optedOutProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.customerUser, ids.optedOutUser]);
      await q(`DELETE FROM services WHERE id IN ($1,$2)`, [ids.servicePromotable, ids.serviceNotPromotable]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      try {
        for (const campaign of originalCampaignStates) {
          await q(`UPDATE notification_campaigns SET is_active = $2 WHERE id = $1`, [campaign.id, campaign.is_active]);
        }
      } finally {
        if (dataSource?.isInitialized) await dataSource.destroy();
      }
    }
  });

  beforeEach(() => {
    sentNotifications.length = 0;
  });

  // ── ملء القوالب ────────────────────────────────────────────────────────────

  it('القالب بيتملى بأسماء حقيقية — ده اللي بيحقق "كل مرة مختلف" بقالب واحد', () => {
    expect(renderCampaignTemplate('محتاج {{service_name}}؟', { service_name: 'تسليك مواسير' })).toBe(
      'محتاج تسليك مواسير؟',
    );
  });

  it('متغيّر مكتوب غلط بيتشال مش بيتعرض للعميل كنص خام', () => {
    // لو العميل شاف `{{prcie}}` في إشعار، ده بيبان كعطل في المنتج مش كغلطة إدخال.
    expect(renderCampaignTemplate('السعر {{prcie}} كويس', {})).toBe('السعر كويس');
    expect(unknownTemplateVariables('السعر {{prcie}} و{{service_name}}')).toEqual(['prcie']);
  });

  // ── الإعلان الدوري ─────────────────────────────────────────────────────────

  it('الإعلان الدوري بيوصل لعميل مؤهل بخدمة مسموح الإعلان عنها', async () => {
    const sent = await service.sweep();
    expect(sent).toBeGreaterThanOrEqual(1);

    const mine = sentNotifications.filter((n) => n.userId === ids.customerUser);
    expect(mine).toHaveLength(1);
    const [loggedService] = await q(
      `SELECT service.name_ar, service.is_promotable, service.is_active, service.deleted_at
         FROM notification_campaign_sends send
         JOIN services service ON service.id = send.service_id
        WHERE send.user_id = $1
        ORDER BY send.sent_at DESC
        LIMIT 1`,
      [ids.customerUser],
    );
    // اسم الخدمة اللي اختيرت عشوائيًا فعلًا ظاهر في النص — مش placeholder ولا نص عام.
    expect(loggedService).toMatchObject({ is_promotable: true, is_active: true, deleted_at: null });
    expect(mine[0].titleAr).toContain(loggedService.name_ar);
    // الخدمة اللي مش is_promotable ما تظهرش أبدًا («ممكن تبقى خدمة إحنا ما نظفناهاش»).
    expect(mine[0].bodyAr).not.toContain('خدمة مش جاهزة');
  });

  it('العميل اللي قافل الإعلانات ما بياخدش حاجة', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    await service.sweep();
    expect(sentNotifications.some((n) => n.userId === ids.optedOutUser)).toBe(false);
  });

  it('الفاصل الدوري بيمنع إعلان تاني لنفس العميل قبل معاده', async () => {
    // في الاختبار اللي فات اتبعتله إعلان لسه، فالدورة دي المفروض تتخطاه.
    await service.sweep();
    expect(sentNotifications.some((n) => n.userId === ids.customerUser)).toBe(false);
  });

  it('السقف الأسبوعي فوق كل الحملات مجتمعة — مهما كان الفاصل الدوري', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    // إرسالين في الأسبوع ده من حملة تانية خالص — السقف المفروض يمنع التالت.
    await q(
      `INSERT INTO notification_campaign_sends (campaign_id, user_id, sent_at)
       VALUES ($1,$2, now() - interval '1 day'), ($1,$2, now() - interval '2 days')`,
      [ids.campaignIntent, ids.customerUser],
    );
    await service.sweep();
    expect(sentNotifications.some((n) => n.userId === ids.customerUser)).toBe(false);

    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
  });

  it('العميل المشغول بطلب شغال دلوقتي مش وقته إعلان', async () => {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'in_progress','pending',30000,0) RETURNING id`,
      [`CMPG-${runId}`.slice(0, 24), ids.customerProfile, ids.servicePromotable, ids.address, ids.zone],
    );
    await service.sweep();
    expect(sentNotifications.some((n) => n.userId === ids.customerUser)).toBe(false);

    // **يتشال مش يتقفل**: الطلب ده على نفس الخدمة، ووجوده بعد وقت الاهتمام بيلغي التذكير في
    // الاختبار اللي بعده (وده سلوك صح من المحرك — العميل حجز فعلاً).
    await q(`DELETE FROM orders WHERE id = $1`, [order.id]);
  });

  it('ساعات الهدوء بتوقف الدورة كلها — الإعلان مالوش أي استعجال', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    const nowHour = new Date().getUTCHours();
    settingsValues.set('campaigns.quiet_hours_start', `${String(nowHour).padStart(2, '0')}:00`);
    settingsValues.set('campaigns.quiet_hours_end', `${String((nowHour + 2) % 24).padStart(2, '0')}:00`);

    expect(await service.sweep()).toBe(0);
    expect(sentNotifications).toHaveLength(0);

    settingsValues.set('campaigns.quiet_hours_start', '00:00');
    settingsValues.set('campaigns.quiet_hours_end', '00:00');
  });

  it('إقفال المحرك بيوقّف كل حاجة فورًا', async () => {
    settingsValues.set('campaigns.enabled', false);
    expect(await service.sweep()).toBe(0);
    settingsValues.set('campaigns.enabled', true);
  });

  // ── استرجاع الاهتمام المتروك ──────────────────────────────────────────────

  it('اهتمام متروك بقاله ساعة بيجيبله تذكير باسم الخدمة نفسها', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    await service.recordIntent(ids.customerUser, ids.servicePromotable, 'viewed_service');
    await q(`UPDATE customer_service_intents SET occurred_at = now() - interval '90 minutes' WHERE user_id = $1`, [
      ids.customerUser,
    ]);

    await service.sweep();
    const mine = sentNotifications.filter((n) => n.userId === ids.customerUser);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].titleAr).toContain(`تسليك مواسير ${runId}`);

    // اتعلّم "اتعالج" — من غير كده بيتحاول عليه كل دورة للأبد.
    const [{ count }] = await q(
      `SELECT COUNT(*) AS count FROM customer_service_intents WHERE user_id = $1 AND processed_at IS NULL`,
      [ids.customerUser],
    );
    expect(Number(count)).toBe(0);
  });

  it('اهتمام لسه جديد (أقل من المهلة) ما بيتبعتش', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    await q(`DELETE FROM customer_service_intents WHERE user_id = $1`, [ids.customerUser]);
    await service.recordIntent(ids.customerUser, ids.servicePromotable, 'started_booking');

    await service.sweep();
    const [{ count }] = await q(
      `SELECT COUNT(*) AS count FROM customer_service_intents WHERE user_id = $1 AND processed_at IS NULL`,
      [ids.customerUser],
    );
    expect(Number(count)).toBe(1); // لسه مستني، ما اتعالجش
  });

  it('العميل حجز الخدمة بعد ما بصّ عليها — مفيش أي تذكير', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    await q(`DELETE FROM customer_service_intents WHERE user_id = $1`, [ids.customerUser]);
    await service.recordIntent(ids.customerUser, ids.servicePromotable, 'viewed_service');
    await q(`UPDATE customer_service_intents SET occurred_at = now() - interval '90 minutes' WHERE user_id = $1`, [
      ids.customerUser,
    ]);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, created_at)
       VALUES ($1,$2,$3,$4,$5,'completed','paid',30000,0, now() - interval '30 minutes') RETURNING id`,
      [`CMPB-${runId}`.slice(0, 24), ids.customerProfile, ids.servicePromotable, ids.address, ids.zone],
    );

    await service.sweep();
    // ممكن ياخد إعلان دوري (وده مقبول)، بس مش تذكير بالخدمة اللي حجزها بالفعل.
    const reminders = sentNotifications.filter(
      (n) => n.userId === ids.customerUser && n.titleAr.startsWith('لسه فاكر'),
    );
    expect(reminders).toHaveLength(0);

    await q(`DELETE FROM orders WHERE id = $1`, [order.id]);
  });

  it('خدمة مش مسموح الإعلان عنها ما بتجيبش تذكير حتى لو العميل بصّ عليها', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    await q(`DELETE FROM customer_service_intents WHERE user_id = $1`, [ids.customerUser]);
    await service.recordIntent(ids.customerUser, ids.serviceNotPromotable, 'viewed_service');
    await q(`UPDATE customer_service_intents SET occurred_at = now() - interval '90 minutes' WHERE user_id = $1`, [
      ids.customerUser,
    ]);

    await service.sweep();
    const reminders = sentNotifications.filter(
      (n) => n.userId === ids.customerUser && n.titleAr.startsWith('لسه فاكر'),
    );
    expect(reminders).toHaveLength(0);
  });

  it('كل إرسال بيتسجّل في السجل الدائم — هو نفسه مصدر الحواجز والتحليل', async () => {
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = $1`, [ids.customerUser]);
    await q(`DELETE FROM customer_service_intents WHERE user_id = $1`, [ids.customerUser]);
    await service.sweep();

    const rows = await q(
      `SELECT send.campaign_id, send.service_id, service.is_promotable, service.is_active, service.deleted_at
         FROM notification_campaign_sends send
         JOIN services service ON service.id = send.service_id
        WHERE send.user_id = $1`,
      [ids.customerUser],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // الخدمة بتتختار عشوائيًا من كل الكاتالوج الحقيقي، فالمهم إن السجل احتفظ بالخدمة اللي اتبعتت
    // فعلًا وإنها قابلة للإعلان — مش إنها fixture بعينها.
    expect(rows[0]).toMatchObject({
      campaign_id: ids.campaignPromo,
      is_promotable: true,
      is_active: true,
      deleted_at: null,
    });
    expect(rows[0].service_id).toEqual(expect.any(String));
  });
});
