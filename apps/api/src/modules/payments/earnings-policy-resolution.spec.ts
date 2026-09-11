import { DataSource } from 'typeorm';
import { EarningsPolicyService } from './earnings-policy.service';
import { EarningsParticipantInput } from './earnings-calculator';

/**
 * **تدقيق حي لطبقة «حلّ السياسة» في سياسة المستحقات** (طلب مالك 2026-09-11).
 *
 * > «تتأكد إن في سياسة المستحقات كل حاجة شغالة بالملي… وزن الفني، وزن المساعد في كل فئة…
 * >  وعامل مهارة الخدمة… ونسبة عمولة المنصة… وتتأكد إن لو عملنا استثناء في أي شيء هيكون
 * >  شغال، استثناء على أي خدمة، استثناء على أي شخص بعينه.»
 *
 * ## ليه السبيك ده موجود رغم إن الحاسبة متغطّية
 *
 * `earnings-calculator.spec.ts` بيغطّي **الحسبة** نفسها بالكامل (أوزان، تقريب، ثوابت) — بس
 * بمدخلات مكتوبة بالإيد. و`earnings-policy.service.spec.ts` بيغطّي الخدمة بـ`query` مزيّف.
 *
 * الطبقة اللي مكانش عليها **أي** تغطية حية هي اللي بينهم: استعلام `resolveParticipants` اللي
 * بيلمّ من ٧ جداول حقيقية (`technician_level_config`، `earnings_skill_policy`،
 * `technician_services`، `service_earnings_level_overrides`، `service_earnings_skill_overrides`،
 * `technician_earning_adjustments`، `order_earning_adjustments`) وبيقرّر **مين بياخد كام**.
 *
 * وده بالظبط مكان بَقّة «الاستثناء مش شغّال»: `JOIN` غلط، أو `ORDER BY` بيختار الاستثناء
 * الغلط، أو شرط صلاحية ناقص — كلها بتعدّي من الحاسبة ومن الـmocks، وبتوصل لفلوس الناس.
 */
describe('سياسة المستحقات — حلّ السياسة من الجداول الحقيقية', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let service: EarningsPolicyService;
  const runId = Date.now().toString(36);
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  const ids = {
    serviceId: '', otherServiceId: '', categoryId: '', zoneId: '',
    customerUserId: '', customerId: '', addressId: '', cityId: '',
    leaderUserId: '', leaderId: '', assistantUserId: '', assistantId: '',
    adminUserId: '', orderId: '',
  };

  /** الأوزان الحقيقية من الجداول — الاختبار بيقيس ضدها مش ضد أرقام مكتوبة هنا. */
  const levelConfig: Record<string, { weight: number; assistantRatio: number }> = {};
  const skillFactor: Record<string, number> = {};

  async function makeUser(kind: string, userType: string): Promise<string> {
    const [row] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3::user_type) RETURNING id`,
      [`+2097${runId}${kind}`.slice(0, 15), `${kind} ${runId}`, userType],
    );
    return (row as { id: string }).id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    service = new EarningsPolicyService(dataSource);

    for (const row of (await q(`SELECT level, earning_weight_bps, assistant_ratio_bps FROM technician_level_config`)) as {
      level: string; earning_weight_bps: number; assistant_ratio_bps: number;
    }[]) {
      levelConfig[row.level] = { weight: Number(row.earning_weight_bps), assistantRatio: Number(row.assistant_ratio_bps) };
    }
    for (const row of (await q(`SELECT skill_level, factor_bps FROM earnings_skill_policy`)) as {
      skill_level: string; factor_bps: number;
    }[]) {
      skillFactor[row.skill_level] = Number(row.factor_bps);
    }

    ids.adminUserId = await makeUser('adm', 'admin');
    ids.customerUserId = await makeUser('cus', 'customer');
    ids.leaderUserId = await makeUser('ldr', 'technician');
    ids.assistantUserId = await makeUser('ast', 'technician');

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [(country as { id: string }).id, `مدينة مستحقات ${runId}`, `Earn City ${runId}`, `earn-city-${runId}`],
    );
    ids.cityId = (city as { id: string }).id;

    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.cityId, `نطاق مستحقات ${runId}`, `Earn Zone ${runId}`],
    );
    ids.zoneId = (zone as { id: string }).id;

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة مستحقات ${runId}`, `Earn Cat ${runId}`, `earn-cat-${runId}`],
    );
    ids.categoryId = (category as { id: string }).id;

    const insertService = async (suffix: string) => {
      const [row] = await q(
        `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage)
         VALUES ($1,$2,$3,'formula',100000,20) RETURNING id`,
        [ids.categoryId, `خدمة مستحقات ${suffix} ${runId}`, `earn-svc-${suffix}-${runId}`],
      );
      return (row as { id: string }).id;
    };
    ids.serviceId = await insertService('a');
    ids.otherServiceId = await insertService('b');

    const [customer] = await q(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUserId]);
    ids.customerId = (customer as { id: string }).id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'شارع الاختبار','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [ids.customerUserId, ids.cityId],
    );
    ids.addressId = (address as { id: string }).id;

    const makeTechnician = async (userId: string, level: string, kind: string, code: string) => {
      const [row] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, current_level, technician_kind, verification_status)
         VALUES ($1,$2,$3::technician_level,$4::technician_kind,'approved') RETURNING id`,
        [userId, `EPR${code}${runId}`.slice(0, 20), level, kind],
      );
      return (row as { id: string }).id;
    };
    ids.leaderId = await makeTechnician(ids.leaderUserId, 'professional', 'technician', 'L');
    ids.assistantId = await makeTechnician(ids.assistantUserId, 'verified', 'assistant', 'A');

    const [order] = await q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
         service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
         technician_id, technician_earning_cents, booking_mode, settlement_policy_version)
       VALUES (20,$1,$2,$3,$4,$5,'work_completed','unpaid',100000,100000,$6,0,'team',2)
       RETURNING id`,
      [`EPR-${runId}`.slice(0, 24), ids.customerId, ids.serviceId, ids.addressId, ids.zoneId, ids.leaderId],
    );
    ids.orderId = (order as { id: string }).id;

    await q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
       VALUES ($1,$2,'مساعد','assistant',$3)`,
      [ids.orderId, ids.assistantId, ids.leaderId],
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM order_earning_adjustments WHERE order_id = $1`, [ids.orderId]);
    await q(`DELETE FROM technician_earning_adjustments WHERE technician_id = ANY($1::uuid[])`,
      [[ids.leaderId, ids.assistantId]]);
    await q(`DELETE FROM service_earnings_level_overrides WHERE service_id = ANY($1::uuid[])`,
      [[ids.serviceId, ids.otherServiceId]]);
    await q(`DELETE FROM service_earnings_skill_overrides WHERE service_id = ANY($1::uuid[])`,
      [[ids.serviceId, ids.otherServiceId]]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`,
      [[ids.leaderId, ids.assistantId]]);
    await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.orderId]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.orderId]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerId]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.leaderId, ids.assistantId]]);
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.serviceId, ids.otherServiceId]]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`,
      [[ids.adminUserId, ids.customerUserId, ids.leaderUserId, ids.assistantUserId]]);
    await dataSource.destroy();
  });

  /** بنمسح كل الاستثناءات قبل كل اختبار — كل حالة لازم تبدأ من نفس الأساس. */
  beforeEach(async () => {
    await q(`DELETE FROM order_earning_adjustments WHERE order_id = $1`, [ids.orderId]);
    await q(`DELETE FROM technician_earning_adjustments WHERE technician_id = ANY($1::uuid[])`,
      [[ids.leaderId, ids.assistantId]]);
    await q(`DELETE FROM service_earnings_level_overrides WHERE service_id = ANY($1::uuid[])`,
      [[ids.serviceId, ids.otherServiceId]]);
    await q(`DELETE FROM service_earnings_skill_overrides WHERE service_id = ANY($1::uuid[])`,
      [[ids.serviceId, ids.otherServiceId]]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`,
      [[ids.leaderId, ids.assistantId]]);
  });

  const byId = (rows: EarningsParticipantInput[], id: string) => rows.find((row) => row.technicianId === id)!;

  // ════════════════ ١ — السلم المهني والأوزان ════════════════

  describe('السلم المهني', () => {
    const LADDER = ['new', 'verified', 'professional', 'premium', 'team_leader'];

    it('كل درجة في السلم ليها صف إعداد — مفيش درجة بلا وزن', async () => {
      for (const level of LADDER) {
        expect(levelConfig[level]).toBeDefined();
      }
      // عكسها كمان: مفيش صف إعداد لدرجة مش في السلم (بيانات يتيمة بتظهر في لوحة الأدمن).
      expect(Object.keys(levelConfig).sort()).toEqual([...LADDER].sort());
    });

    it('الوزن بيزيد مع الترقي — مستحيل ترقية تقلّل نصيب الفني', () => {
      for (let index = 1; index < LADDER.length; index += 1) {
        expect(levelConfig[LADDER[index]].weight).toBeGreaterThan(levelConfig[LADDER[index - 1]].weight);
      }
    });

    it('نسبة المساعد بتزيد مع الترقي وماتعدّيش ١٠٠٪ أبدًا', () => {
      for (let index = 1; index < LADDER.length; index += 1) {
        expect(levelConfig[LADDER[index]].assistantRatio).toBeGreaterThan(levelConfig[LADDER[index - 1]].assistantRatio);
      }
      for (const level of LADDER) {
        // نسبة > ١٠٠٪ معناها المساعد بياخد أكتر من فني في نفس الدرجة — انعكاس كامل للمعنى.
        expect(levelConfig[level].assistantRatio).toBeGreaterThan(0);
        expect(levelConfig[level].assistantRatio).toBeLessThanOrEqual(10_000);
      }
    });

    it('عامل المهارة: القياسي محايد تمامًا، والمبتدئ < القياسي < الخبير', () => {
      // «قياسي» هو الـfallback لما الفني مالوش صف مهارة على الخدمة — فلازم يكون محايد بالظبط،
      // وإلا الغياب نفسه بيغيّر الفلوس.
      expect(skillFactor.standard).toBe(10_000);
      expect(skillFactor.beginner).toBeLessThan(skillFactor.standard);
      expect(skillFactor.expert).toBeGreaterThan(skillFactor.standard);
    });
  });

  // ════════════════ ٢ — الأوزان بتوصل للحسبة فعلاً ════════════════

  describe('الوزن الفعلي المحسوب', () => {
    it('بيبني وزن القائد من وزن درجته × عامل مهارته × ١ (مفيش نسبة مساعد على القائد)', async () => {
      await q(
        `INSERT INTO technician_services (technician_id, service_id, skill_level) VALUES ($1,$2,'expert')`,
        [ids.leaderId, ids.serviceId],
      );
      const result = await service.calculateOrder(ids.orderId, 100_000);
      const leader = result.participantShares.find((row) => row.technicianId === ids.leaderId)!;

      expect(leader.isLeader).toBe(true);
      expect(leader.earningRole).toBe('technician');
      expect(leader.levelWeightBps).toBe(levelConfig.professional.weight);
      expect(leader.serviceSkillFactorBps).toBe(skillFactor.expert);
      // المعادلة الكاملة زي ما `effectiveWeight` بيحسبها — بلا أي رقم مكتوب بالإيد.
      expect(leader.effectiveWeightUnits).toBe(
        (BigInt(levelConfig.professional.weight) * 10_000n * BigInt(skillFactor.expert) * 10_000n * 10_000n).toString(),
      );
    });

    it('بيضرب نسبة المساعد في وزن **درجة المساعد نفسه**، مش درجة القائد', async () => {
      const result = await service.calculateOrder(ids.orderId, 100_000);
      const assistant = result.participantShares.find((row) => row.technicianId === ids.assistantId)!;

      expect(assistant.earningRole).toBe('assistant');
      // المساعد درجته `verified` والقائد `professional` — لو الاستعلام خلط بينهم، الرقمين هيبانوا.
      expect(assistant.levelWeightBps).toBe(levelConfig.verified.weight);
      expect(assistant.assistantRatioBps).toBe(levelConfig.verified.assistantRatio);
      expect(assistant.effectiveWeightUnits).toBe(
        (BigInt(levelConfig.verified.weight) * BigInt(levelConfig.verified.assistantRatio) *
          BigInt(skillFactor.standard) * 10_000n * 10_000n).toString(),
      );
    });

    it('فني بلا صف مهارة على الخدمة بياخد «قياسي» المحايد — مش صفر ولا سقوط من القسمة', async () => {
      const participants = await service.resolveParticipants(ids.orderId);
      expect(participants).toHaveLength(2);
      expect(byId(participants, ids.leaderId).serviceSkill).toBe('standard');
      expect(byId(participants, ids.leaderId).serviceSkillFactorBps).toBe(10_000);
    });

    it('صف مهارة مش معتمد أو موقوف مابيتحسبش — بيرجع للمحايد', async () => {
      await q(
        `INSERT INTO technician_services (technician_id, service_id, skill_level, verification_status)
         VALUES ($1,$2,'expert','pending_verification')`,
        [ids.leaderId, ids.serviceId],
      );
      let participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.leaderId).serviceSkillFactorBps).toBe(10_000);

      await q(`UPDATE technician_services SET verification_status = 'approved', is_active = false
                WHERE technician_id = $1 AND service_id = $2`, [ids.leaderId, ids.serviceId]);
      participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.leaderId).serviceSkillFactorBps).toBe(10_000);
    });

    it('مهارة الفني على **خدمة تانية** مابتأثرش على الطلب ده', async () => {
      await q(
        `INSERT INTO technician_services (technician_id, service_id, skill_level) VALUES ($1,$2,'expert')`,
        [ids.leaderId, ids.otherServiceId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.leaderId).serviceSkillFactorBps).toBe(10_000);
    });
  });

  // ════════════════ ٣ — عمولة المنصة ════════════════

  describe('عمولة المنصة', () => {
    it('وعاء العمّال بيتحسب من **وعاء العمولة** لوحده — اللي بره الوعاء بيفضل كله للمنصة', async () => {
      // ADR-0037 بالحرف: الضمان الاختياري ومضاعف الطوارئ ومضاعف المنطقة **بره وعاء العمولة**،
      // لأنهم إيراد المنصة على مخاطرة بتتحمّلها هي. فالمعادلة:
      //   نصيب العمّال = الوعاء − (الوعاء × النسبة)
      //   نصيب المنصة  = الإجمالي − نصيب العمّال      ← بياخد الفرق كله
      //
      // إجمالي ١٢٠٠ ج.م ووعاء ١٠٠٠ ج.م بنسبة ٢٠٪:
      //   العمّال = 1000 − 200 = 800،  المنصة = 1200 − 800 = 400.
      //
      // **الغلط الشائع اللي الاختبار ده بيقفله**: توقّع إن المنصة تاخد ٢٠٠ (نسبتها من الوعاء
      // بس) والـ٢٠٠ اللي بره الوعاء تروح للفني. ده كان هيدّي الفني نصيب من سعر الضمان — وهو
      // بالظبط البلاغ اللي ADR-0037 اتكتب عشانه.
      await q(`UPDATE orders SET commissionable_base_cents = 100000 WHERE id = $1`, [ids.orderId]);
      const result = await service.calculateOrder(ids.orderId, 120_000);

      expect(result.workerPoolCents).toBe(80_000);
      expect(result.platformCommissionCents).toBe(40_000);
      // الثابت المالي: مفيش قرش بيتخلق ولا بيضيع.
      const distributed = result.participantShares.reduce((sum, row) => sum + row.shareCents, 0);
      expect(distributed + result.platformCommissionCents).toBe(120_000);
    });

    it('لما الإجمالي = الوعاء، نصيب المنصة = النسبة بالظبط', async () => {
      const result = await service.calculateOrder(ids.orderId, 100_000);
      expect(result.platformCommissionCents).toBe(20_000);
      expect(result.workerPoolCents).toBe(80_000);
    });

    it('بتستخدم **نسخة النسبة المثبّتة على الطلب**، فتغيير الكتالوج بعدين مابيحرّكش طلب قديم', async () => {
      await q(`UPDATE services SET commission_percentage = 45 WHERE id = $1`, [ids.serviceId]);
      try {
        const result = await service.calculateOrder(ids.orderId, 100_000);
        // الطلب متسجّل عليه ٢٠٪ — الكتالوج بقى ٤٥٪ ومالوش أي أثر.
        expect(result.platformCommissionCents).toBe(20_000);
      } finally {
        await q(`UPDATE services SET commission_percentage = 20 WHERE id = $1`, [ids.serviceId]);
      }
    });

    it('مجموع الحصص = وعاء العمّال بالظبط على أرقام وحشة', async () => {
      // ١٠٠٬٠٠٣ قرش على مشاركين بأوزان مش متساوية = باقي تقسيم أكيد.
      const result = await service.calculateOrder(ids.orderId, 100_003);
      const distributed = result.participantShares.reduce((sum, row) => sum + row.shareCents, 0);
      expect(distributed).toBe(result.workerPoolCents);
      expect(result.workerPoolCents + result.platformCommissionCents).toBe(100_003);
    });
  });

  // ════════════════ ٤ — الاستثناءات ════════════════

  describe('الاستثناءات', () => {
    it('استثناء نسبة المساعد **على خدمة بعينها** بيغلب الإعداد العام', async () => {
      await q(
        `INSERT INTO service_earnings_level_overrides (service_id, technician_level, assistant_ratio_bps, updated_by_user_id)
         VALUES ($1,'verified'::technician_level,9500,$2)`,
        [ids.serviceId, ids.adminUserId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.assistantId).assistantRatioBps).toBe(9_500);
      // والقائد مالوش علاقة — الاستثناء على نسبة المساعد بس.
      expect(byId(participants, ids.leaderId).levelWeightBps).toBe(levelConfig.professional.weight);
    });

    it('استثناء نسبة المساعد على **درجة تانية** مابيلمسش المساعد ده', async () => {
      await q(
        `INSERT INTO service_earnings_level_overrides (service_id, technician_level, assistant_ratio_bps, updated_by_user_id)
         VALUES ($1,'premium'::technician_level,9900,$2)`,
        [ids.serviceId, ids.adminUserId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.assistantId).assistantRatioBps).toBe(levelConfig.verified.assistantRatio);
    });

    it('استثناء نسبة المساعد على **خدمة تانية** مابيسربش للطلب ده', async () => {
      await q(
        `INSERT INTO service_earnings_level_overrides (service_id, technician_level, assistant_ratio_bps, updated_by_user_id)
         VALUES ($1,'verified'::technician_level,9500,$2)`,
        [ids.otherServiceId, ids.adminUserId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.assistantId).assistantRatioBps).toBe(levelConfig.verified.assistantRatio);
    });

    it('استثناء عامل المهارة على خدمة بعينها بيغلب السياسة العامة', async () => {
      await q(
        `INSERT INTO service_earnings_skill_overrides (service_id, skill_level, factor_bps, updated_by_user_id)
         VALUES ($1,'standard'::skill_level,12500,$2)`,
        [ids.serviceId, ids.adminUserId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      // الاتنين على «قياسي» (مفيش صف مهارة)، فالاستثناء بيوصلهم الاتنين.
      expect(byId(participants, ids.leaderId).serviceSkillFactorBps).toBe(12_500);
      expect(byId(participants, ids.assistantId).serviceSkillFactorBps).toBe(12_500);
    });

    it('استثناء **على شخص بعينه** بيتطبّق عليه هو بس', async () => {
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id)
         VALUES ($1,1500,'مكافأة أداء',$2,$2)`,
        [ids.leaderId, ids.adminUserId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.leaderId).individualAdjustmentBps).toBe(1_500);
      expect(byId(participants, ids.assistantId).individualAdjustmentBps).toBe(0);
    });

    it('استثناء على **مساعد** بعينه شغّال زي الفني بالظبط', async () => {
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id)
         VALUES ($1,800,'مكافأة مساعد',$2,$2)`,
        [ids.assistantId, ids.adminUserId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.assistantId).individualAdjustmentBps).toBe(800);
      expect(byId(participants, ids.leaderId).individualAdjustmentBps).toBe(0);
    });

    it('استثناء الشخص **المقيّد بخدمة** بيغلب استثناءه العام على نفس الخدمة', async () => {
      // ده شرط `ORDER BY (tea.service_id = o.service_id) DESC` في الاستعلام. لو اتقلب، الاستثناء
      // العام كان هيغلب المخصوص — يعني الأدمن يحدد استثناء لخدمة والنظام يتجاهله في صمت.
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, service_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id)
         VALUES ($1,NULL,500,'عام',$2,$2), ($1,$3,2500,'مخصوص للخدمة دي',$2,$2)`,
        [ids.leaderId, ids.adminUserId, ids.serviceId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.leaderId).individualAdjustmentBps).toBe(2_500);
    });

    it('استثناء مقيّد بخدمة **تانية** بيسيب الاستثناء العام شغّال على الطلب ده', async () => {
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, service_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id)
         VALUES ($1,NULL,500,'عام',$2,$2), ($1,$3,2500,'لخدمة تانية',$2,$2)`,
        [ids.leaderId, ids.adminUserId, ids.otherServiceId],
      );
      const participants = await service.resolveParticipants(ids.orderId);
      expect(byId(participants, ids.leaderId).individualAdjustmentBps).toBe(500);
    });

    it('استثناء موقوف أو منتهي أو لسه مابدأش مابيتحسبش', async () => {
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id, disabled_at)
         VALUES ($1,3000,'موقوف',$2,$2, now())`,
        [ids.leaderId, ids.adminUserId],
      );
      expect(byId(await service.resolveParticipants(ids.orderId), ids.leaderId).individualAdjustmentBps).toBe(0);

      await q(`DELETE FROM technician_earning_adjustments WHERE technician_id = $1`, [ids.leaderId]);
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id, effective_from, effective_until)
         VALUES ($1,3000,'منتهي',$2,$2, now() - interval '10 days', now() - interval '1 day')`,
        [ids.leaderId, ids.adminUserId],
      );
      expect(byId(await service.resolveParticipants(ids.orderId), ids.leaderId).individualAdjustmentBps).toBe(0);

      await q(`DELETE FROM technician_earning_adjustments WHERE technician_id = $1`, [ids.leaderId]);
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id, effective_from)
         VALUES ($1,3000,'لسه مابدأش',$2,$2, now() + interval '5 days')`,
        [ids.leaderId, ids.adminUserId],
      );
      expect(byId(await service.resolveParticipants(ids.orderId), ids.leaderId).individualAdjustmentBps).toBe(0);
    });

    it('استثناء **على طلب بعينه** بيتطبّق، وبيتضرب مع استثناء الشخص مش بيحل محله', async () => {
      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id)
         VALUES ($1,1000,'استثناء شخص',$2,$2)`,
        [ids.leaderId, ids.adminUserId],
      );
      await q(
        `INSERT INTO order_earning_adjustments (order_id, technician_id, adjustment_bps, reason, created_by_user_id)
         VALUES ($1,$2,2000,'شغل إضافي في الطلب ده',$3)`,
        [ids.orderId, ids.leaderId, ids.adminUserId],
      );
      const result = await service.calculateOrder(ids.orderId, 100_000);
      const leader = result.participantShares.find((row) => row.technicianId === ids.leaderId)!;

      expect(leader.individualAdjustmentBps).toBe(1_000);
      expect(leader.orderAdjustmentBps).toBe(2_000);
      // الاتنين معاملين مستقلين بيتضربوا: ١١٠٪ × ١٢٠٪ — مش واحد بيلغي التاني.
      expect(leader.effectiveWeightUnits).toBe(
        (BigInt(levelConfig.professional.weight) * 10_000n * BigInt(skillFactor.standard) * 11_000n * 12_000n).toString(),
      );
    });

    it('استثناء سالب بيقلّل النصيب فعلاً — والفلوس بتروح لباقي الطاقم مش للمنصة', async () => {
      const before = await service.calculateOrder(ids.orderId, 100_000);
      const assistantBefore = before.participantShares.find((row) => row.technicianId === ids.assistantId)!.shareCents;

      await q(
        `INSERT INTO technician_earning_adjustments
           (technician_id, adjustment_bps, reason, created_by_user_id, updated_by_user_id)
         VALUES ($1,-3000,'خصم انضباط',$2,$2)`,
        [ids.leaderId, ids.adminUserId],
      );
      const after = await service.calculateOrder(ids.orderId, 100_000);
      const leaderAfter = after.participantShares.find((row) => row.technicianId === ids.leaderId)!;
      const assistantAfter = after.participantShares.find((row) => row.technicianId === ids.assistantId)!;

      expect(leaderAfter.shareCents).toBeLessThan(
        before.participantShares.find((row) => row.technicianId === ids.leaderId)!.shareCents);
      expect(assistantAfter.shareCents).toBeGreaterThan(assistantBefore);
      // **عمولة المنصة ماتحركتش**: الخصم بيعيد توزيع وعاء العمّال، مش بيزوّد نصيب المنصة.
      expect(after.platformCommissionCents).toBe(before.platformCommissionCents);
      expect(after.workerPoolCents).toBe(before.workerPoolCents);
    });
  });
});
