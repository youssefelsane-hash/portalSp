import { DataSource } from 'typeorm';
import { CrewEarningsService, DEFAULT_ASSISTANT_SHARE_RATIO } from './crew-earnings.service';
import { splitCrewEarnings } from './crew-earning-split';
import { SettingsService } from '../settings/settings.service';
import { Order } from '../orders/entities/order.entity';

/**
 * ADR-0043 / docs/08 §66 — بلاغ المالك: «المفروض فيه فنيين وفيه مساعدين… المفروض ده ما بياخدش
 * زي ده، بيكون فيه فرق».
 *
 * الفجوة اللي كانت: `splitCrewEarnings` بتوزّع بوزن **المستوى** بس، و`participant_role` كان
 * محمول في البيانات ومش داخل الحسبة خالص — فمساعد `new` كان بياخد بالظبط زي فني `new`.
 *
 * الاختبار حي على Postgres حقيقي عشان يغطّي الاستعلام نفسه (الأدوار بتيجي من
 * `order_team_members.member_type`) مش الحسبة بس.
 */
describe('حصة المساعد داخل الطاقم (ADR-0043، docs/08 §66)', () => {
  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const ids = { leader: '', tech: '', assistant: '', order: '', customer: '', customerProfile: '', category: '', service: '', address: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  function serviceWith(ratio: number | null): CrewEarningsService {
    const settings = ratio === null
      ? undefined
      : ({ getNumber: async () => ratio } as unknown as SettingsService);
    return new CrewEarningsService(settings);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();

    const mk = async (name: string) => {
      const [u] = await q(
        `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at)
         VALUES ($1,$2,'technician',now()) RETURNING id`,
        [`+2033${runId}${name.length}`.slice(0, 15), `${name} ${runId}`],
      );
      // كلهم نفس المستوى عمدًا — عشان الفرق الوحيد اللي ممكن يفسّر اختلاف الحصص هو **الدور**.
      const [p] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
         VALUES ($1,$2,'new','approved') RETURNING id`,
        [u.id, `TC-${runId}-${name}`.slice(0, 20)],
      );
      return p.id as string;
    };
    ids.leader = await mk('قائد');
    ids.tech = await mk('فني');
    ids.assistant = await mk('مساعد');

    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2034${runId}`.slice(0, 15), `عميل ${runId}`],
    );
    ids.customer = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customer, `عنوان ${runId}`],
    );
    ids.address = addr.id;
    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة طاقم ${runId}`, `Crew ${runId}`, `crew-cat-${runId}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',100000) RETURNING id`,
      [ids.category, `خدمة طاقم ${runId}`, `crew-svc-${runId}`],
    );
    ids.service = svc.id;
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, technician_id,
                           order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'work_completed','unpaid',100000,80000) RETURNING id`,
      [`CREW-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.leader],
    );
    ids.order = order.id;
    await q(
      `INSERT INTO order_team_members (order_id, technician_id, member_type, role_label, added_by_technician_id)
       VALUES ($1,$2,'team_member','فني',$4), ($1,$3,'assistant','مساعد',$4)`,
      [ids.order, ids.tech, ids.assistant, ids.leader],
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM order_earning_shares WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.leader, ids.tech, ids.assistant]]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customer]);
    await q(`DELETE FROM users WHERE id IN (SELECT user_id FROM technician_profiles WHERE id = ANY($1::uuid[]))`, [
      [ids.leader, ids.tech, ids.assistant],
    ]);
    await dataSource.destroy();
  });

  async function order(): Promise<Order> {
    const [row] = (await q(`SELECT id, technician_id FROM orders WHERE id = $1`, [ids.order])) as {
      id: string;
      technician_id: string;
    }[];
    return Object.assign(new Order(), { id: row.id, technicianId: row.technician_id });
  }

  it('المساعد بياخد أقل من الفني في **نفس** المستوى — الدور بقى داخل الحسبة', async () => {
    const participants = await serviceWith(0.65).resolveParticipants(dataSource.manager, await order());
    const tech = participants.find((p) => p.technicianId === ids.tech)!;
    const assistant = participants.find((p) => p.technicianId === ids.assistant)!;

    expect(tech.technicianLevel).toBe(assistant.technicianLevel); // نفس المستوى بالظبط
    expect(assistant.shareWeight).toBeCloseTo(tech.shareWeight * 0.65, 5);

    const shares = splitCrewEarnings(80000, participants);
    const techShare = shares.find((s) => s.technicianId === ids.tech)!.shareCents;
    const assistantShare = shares.find((s) => s.technicianId === ids.assistant)!.shareCents;
    expect(assistantShare).toBeLessThan(techShare);
    // الثابت الحاكم لـADR-0040 لسه محفوظ: مجموع الحصص = الوعاء بالظبط، مفيش قرش ضايع.
    expect(shares.reduce((sum, s) => sum + s.shareCents, 0)).toBe(80000);
  });

  it('مثال المالك الحرفي: الفني 700 → المساعد 450 تقريبًا (النسبة الافتراضية 0.65)', async () => {
    const participants = await serviceWith(DEFAULT_ASSISTANT_SHARE_RATIO).resolveParticipants(
      dataSource.manager,
      await order(),
    );
    const tech = participants.find((p) => p.technicianId === ids.tech)!;
    const assistant = participants.find((p) => p.technicianId === ids.assistant)!;
    // 700 ج.م للفني → 700 × 0.65 = 455 للمساعد (المالك قال 450).
    expect(Math.round(70000 * (assistant.shareWeight / tech.shareWeight)) / 100).toBeCloseTo(455, 0);
  });

  it('الأدمن بيغيّر النسبة والتوزيع بيتغيّر معاها فورًا', async () => {
    const half = await serviceWith(0.5).resolveParticipants(dataSource.manager, await order());
    const full = await serviceWith(1).resolveParticipants(dataSource.manager, await order());
    const w = (list: typeof half, id: string) => list.find((p) => p.technicianId === id)!.shareWeight;

    expect(w(half, ids.assistant)).toBeCloseTo(w(half, ids.tech) * 0.5, 5);
    // 1.00 = المساعد زي الفني بالظبط — السلوك القديم لسه ممكن لو المالك عايزه.
    expect(w(full, ids.assistant)).toBeCloseTo(w(full, ids.tech), 5);
  });

  it('إعداد غلط (سالب أو أكبر من 1) بيتلجم — المساعد ما ياخدش أكتر من الفني أبدًا', async () => {
    const tooHigh = await serviceWith(5).resolveParticipants(dataSource.manager, await order());
    const negative = await serviceWith(-3).resolveParticipants(dataSource.manager, await order());
    const w = (list: typeof tooHigh, id: string) => list.find((p) => p.technicianId === id)!.shareWeight;

    expect(w(tooHigh, ids.assistant)).toBeLessThanOrEqual(w(tooHigh, ids.tech));
    expect(w(negative, ids.assistant)).toBeGreaterThan(0);
  });

  it('القائد وعضو الفريق ما اتأثروش — المعامل على المساعد بس', async () => {
    const participants = await serviceWith(0.65).resolveParticipants(dataSource.manager, await order());
    const leader = participants.find((p) => p.technicianId === ids.leader)!;
    const tech = participants.find((p) => p.technicianId === ids.tech)!;
    // كلهم مستوى `new` (وزن 1.00) — فالقائد والعضو لازم يفضلوا بوزن المستوى الخام.
    expect(leader.shareWeight).toBeCloseTo(1, 5);
    expect(tech.shareWeight).toBeCloseTo(1, 5);
  });
});
