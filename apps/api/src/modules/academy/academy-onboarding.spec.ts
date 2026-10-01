import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { ComplaintStatusChangedEvent } from '../../common/events/complaint-status-changed.event';
import { RatingSubmittedEvent } from '../../common/events/rating-submitted.event';
import { RatingType } from '../ratings/entities/rating.entity';
import { AcademyRetrainingListener } from './academy-retraining.listener';
import { AcademyService } from './academy.service';
import { gradeQuiz, publicQuestions } from './academy-onboarding';
import { AcademyCourse } from './entities/academy-course.entity';
import { AdminTechniciansService } from '../technicians/admin-technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianDocument } from '../technicians/entities/technician-document.entity';
import { TechnicianLevelHistory } from '../technicians/entities/technician-level-history.entity';
import { TechnicianZone } from '../technicians/entities/technician-zone.entity';
import { TechnicianService as TechnicianServiceEntity } from '../catalog/entities/technician-service.entity';
import { Service } from '../catalog/entities/service.entity';
import { User } from '../auth/entities/user.entity';
import { AcademyExamAttempt } from './entities/academy-exam-attempt.entity';

/**
 * **الأكاديمية كدورة: كورس إلزامي ⇒ امتحان في السيرفر ⇒ إعادة تدريب** (ADR-0117، docs/08 §189 D-3).
 * Postgres حقيقي، والكورس هو المزروع فعلاً في migration 0375 (مش fixture موازي).
 */
describe('الأكاديمية — الكورس الإلزامي وإعادة التدريب (ADR-0117)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let academy: AcademyService;
  let listener: AcademyRetrainingListener;
  const notified: Array<{ userId: string; notificationType: string }> = [];
  const routed: string[] = [];
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { techUser: '', tech: '', customerUser: '', customerProfile: '', city: '', zone: '', category: '', service: '', address: '', order: '' };
  let course: AcademyCourse;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
  const correctAnswers = () => course.quizQuestions.map((qq) => qq.correct_index);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      // كل الكيانات: علاقات AcademyExamAttempt (فني/مستخدم) بتسحب شبكة كيانات كاملة.
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    });
    await dataSource.initialize();
    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2011${runId}`.slice(0, 14),
      `فني أكاديمية ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [tech] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'new','pending') RETURNING id`,
      [ids.techUser, `ACAD${runId}`.slice(0, 20)],
    );
    ids.tech = tech.id;

    const [courseRow] = await q(`SELECT id FROM academy_courses WHERE course_key = 'customer_conduct_policy' AND deleted_at IS NULL`);
    course = (await dataSource.getRepository(AcademyCourse).findOneByOrFail({ id: courseRow.id }))!;

    academy = new AcademyService(
      dataSource.getRepository(AcademyCourse),
      dataSource.getRepository(AcademyExamAttempt),
      { record: async () => undefined } as never,
      dataSource,
    );
    listener = new AcademyRetrainingListener(
      dataSource,
      { getNumber: async (_k: string, fallback: number) => fallback } as never,
      { notify: async (input: { userId: string; notificationType: string }) => { notified.push(input); return {}; } } as never,
      { routeToRole: async (event: string) => { routed.push(event); } } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM ratings WHERE rated_user_id = $1`, [ids.techUser]);
      await q(`DELETE FROM complaints WHERE against_user_id = $1`, [ids.techUser]);
      if (ids.order) await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM academy_exam_attempts WHERE technician_id = $1`, [ids.tech]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.tech]);
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.techUser, ids.customerUser].filter(Boolean)]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      if (ids.zone) await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      if (ids.city) await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('الكورس المزروع إلزامي، والأسئلة اللي بتطلع للتطبيق مافيهاش الإجابة الصح', () => {
    expect(course.isMandatoryOnboarding).toBe(true);
    expect(course.quizQuestions.length).toBe(8);
    const outgoing = publicQuestions(course.quizQuestions);
    expect(JSON.stringify(outgoing)).not.toContain('correct_index');
    expect(outgoing[0]).toEqual({ id: 'q1', prompt_ar: course.quizQuestions[0].prompt_ar, options_ar: course.quizQuestions[0].options_ar });
  });

  it('تعديل الأسئلة يتخزن ويظهر للفني، من غير تغيير نتيجة محاولة سابقة', async () => {
    const questions = [{ id: 'q1', prompt_ar: 'سؤال تجريبي', options_ar: ['صحيح', 'خطأ'], correct_index: 0 }];
    const [row] = await q(
      `INSERT INTO academy_courses (title_ar, title_en, passing_score, display_order, is_active, quiz_questions, is_mandatory_onboarding)
       VALUES ($1, $2, 80, 99, true, $3::jsonb, false) RETURNING id`,
      [`كورس تحرير ${runId}`, `Edit course ${runId}`, JSON.stringify(questions)],
    );
    try {
      const earlier = await academy.submitAttempt(ids.tech, row.id, [0]);
      expect(earlier.attempt.score).toBe(100);

      const edited = [{ id: 'q1', prompt_ar: 'السؤال بعد التعديل', options_ar: ['إجابة قديمة', 'إجابة جديدة'], correct_index: 1 }];
      await academy.updateCourse(ids.techUser, row.id, { quiz_questions: edited });

      const persisted = await dataSource.getRepository(AcademyCourse).findOneByOrFail({ id: row.id });
      expect(persisted.quizQuestions).toEqual(edited);
      expect(publicQuestions(persisted.quizQuestions)).toEqual([{ id: 'q1', prompt_ar: edited[0].prompt_ar, options_ar: edited[0].options_ar }]);

      const [oldAttempt] = await q(`SELECT score, passed FROM academy_exam_attempts WHERE id = $1`, [earlier.attempt.id]);
      expect(Number(oldAttempt.score)).toBe(100);
      expect(oldAttempt.passed).toBe(true);
      const next = await academy.submitAttempt(ids.tech, row.id, [1]);
      expect(next.grade.score).toBe(100);
    } finally {
      await q(`DELETE FROM academy_exam_attempts WHERE course_id = $1`, [row.id]);
      await q(`DELETE FROM academy_courses WHERE id = $1`, [row.id]);
    }
  });

  it('التصحيح: ٧/٨ = 88 ناجح، ٦/٨ = 75 راسب (حد النجاح 80)', () => {
    const answers = correctAnswers();
    const oneWrong = answers.map((a, i) => (i === 0 ? (a + 1) % 3 : a));
    const twoWrong = oneWrong.map((a, i) => (i === 1 ? (a + 1) % 3 : a));
    expect(gradeQuiz(course.quizQuestions, oneWrong).score).toBe(88);
    expect(gradeQuiz(course.quizQuestions, twoWrong).score).toBe(75);
    expect(gradeQuiz(course.quizQuestions, twoWrong).results.filter((r) => !r)).toHaveLength(2);
  });

  it('فني جديد: الإلزامي ناقص ⇒ امتحان ناقص الإجابات مرفوض ⇒ راسب ⇒ ناجح ويكتمل', async () => {
    expect((await academy.onboardingStatus(ids.tech)).complete).toBe(false);
    await expect(academy.submitAttempt(ids.tech, course.id, [0, 1])).rejects.toMatchObject({ status: 400 });

    const wrong = correctAnswers().map((a) => (a + 1) % 3);
    const failed = await academy.submitAttempt(ids.tech, course.id, wrong);
    expect(failed.attempt.passed).toBe(false);
    expect(failed.attempt.source).toBe('self');
    expect(failed.onboarding.complete).toBe(false);

    const passed = await academy.submitAttempt(ids.tech, course.id, correctAnswers());
    expect(passed.grade.score).toBe(100);
    expect(passed.onboarding.complete).toBe(true);
  });

  it('شكوى أسلوب اتحلّت بإجراء ⇒ إعادة تدريب مرة واحدة، والنجاح القديم مابيشيلهاش', async () => {
    const [complaint] = await q(
      `INSERT INTO complaints (complaint_number, filed_by_user_id, against_user_id, category, title, description, sla_due_at,
          complaint_status, resolution_type)
       VALUES ($1, $2, $2, 'rude_behavior', 't', 'd', now() + interval '1 day', 'resolved', 'warning_issued') RETURNING id`,
      [`ACD-${runId}`, ids.techUser],
    );
    await listener.onComplaintStatusChanged(new ComplaintStatusChangedEvent(complaint.id, `ACD-${runId}`, ids.techUser, 'اتحلّت'));
    await listener.onComplaintStatusChanged(new ComplaintStatusChangedEvent(complaint.id, `ACD-${runId}`, ids.techUser, 'اتحلّت'));

    expect(notified.filter((n) => n.userId === ids.techUser && n.notificationType === 'academy_retraining_required')).toHaveLength(1);
    expect(routed).toContain('technician.retraining_required');
    const status = await academy.onboardingStatus(ids.tech);
    expect(status.retraining_required).toBe(true);
    expect(status.retraining_reason).toContain(`ACD-${runId}`);
    expect(status.complete).toBe(false); // النجاح اللي قبل العلامة مابيحسبش
  });

  it('النجاح بعد العلامة بيشيل إعادة التدريب لوحده', async () => {
    const result = await academy.submitAttempt(ids.tech, course.id, correctAnswers());
    expect(result.onboarding.retraining_required).toBe(false);
    expect(result.onboarding.complete).toBe(true);
    const [row] = await q(`SELECT retraining_required_at FROM technician_profiles WHERE id = $1`, [ids.tech]);
    expect(row.retraining_required_at).toBeNull();
  });

  it('شكوى أسلوب اتقفلت «بلا إجراء» ⇒ مفيش إعادة تدريب', async () => {
    const before = notified.length;
    const [complaint] = await q(
      `INSERT INTO complaints (complaint_number, filed_by_user_id, against_user_id, category, title, description, sla_due_at,
          complaint_status, resolution_type)
       VALUES ($1, $2, $2, 'rude_behavior', 't', 'd', now() + interval '1 day', 'resolved', 'no_action') RETURNING id`,
      [`ACN-${runId}`, ids.techUser],
    );
    await listener.onComplaintStatusChanged(new ComplaintStatusChangedEvent(complaint.id, `ACN-${runId}`, ids.techUser, 'اتحلّت'));
    expect(notified.length).toBe(before);
  });

  it('تقييم احترافية 2 من العميل ⇒ إعادة تدريب؛ و4 ⇒ لأ', async () => {
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id, `مدينة أكاديمية ${runId}`, `Academy City ${runId}`, `academy-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [ids.city, `ن ${runId}`, `Z ${runId}`]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [`ف ${runId}`, `C ${runId}`, `academy-cat-${runId}`]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خ ${runId}`, `academy-svc-${runId}`],
    );
    ids.service = service.id;
    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2012${runId}`.slice(0, 14), `عميل أكاديمية ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,'ش', ST_SetSRID(ST_MakePoint(31.2,30.0),4326)::geography) RETURNING id`,
      [ids.customerUser],
    );
    ids.address = address.id;
    const [order] = await q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES (20, $1, $2, $3, $4, $5, $6, 'completed', 'paid', 10000, 0) RETURNING id`,
      [`ACO-${runId}`, ids.customerProfile, ids.tech, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    const rate = async (professionalism: number) => {
      await q(`DELETE FROM ratings WHERE order_id = $1`, [ids.order]);
      const [rating] = await q(
        `INSERT INTO ratings (order_id, rated_by_user_id, rated_user_id, rating_type, overall_rating, professionalism_rating)
         VALUES ($1, $2, $3, 'customer_to_technician', 3, $4) RETURNING id`,
        [ids.order, ids.customerUser, ids.techUser, professionalism],
      );
      await listener.onRatingSubmitted(new RatingSubmittedEvent(rating.id, ids.order, RatingType.CUSTOMER_TO_TECHNICIAN, 3, ids.techUser));
    };

    await rate(4);
    expect((await academy.onboardingStatus(ids.tech)).retraining_required).toBe(false);
    await rate(2);
    const status = await academy.onboardingStatus(ids.tech);
    expect(status.retraining_required).toBe(true);
    expect(status.retraining_reason).toContain('احترافية 2/5');
  });

  it('بوابة الاعتماد: مقفولة ⇒ عادي؛ مفتوحة ⇒ مرفوض لحد ما يخلّص، وsuper_admin بس يعدّي بسبب مكتوب', async () => {
    const settings = (gate: boolean) =>
      ({
        getBoolean: async (key: string, fallback: boolean) =>
          key === 'academy.onboarding_gate_enabled' ? gate : key === 'technicians.require_national_id_for_approval' ? false : fallback,
      }) as never;
    const build = (gate: boolean) =>
      new AdminTechniciansService(
        dataSource.getRepository(TechnicianProfile),
        dataSource.getRepository(TechnicianDocument),
        dataSource.getRepository(TechnicianLevelHistory),
        dataSource.getRepository(TechnicianZone),
        dataSource.getRepository(TechnicianServiceEntity),
        dataSource.getRepository(Service),
        dataSource.getRepository(User),
        { emit: () => undefined } as never,
        { record: async () => undefined } as never,
        {} as never,
        settings(gate),
      );
    // فني تاني جديد مامتحنش خالص
    const [u] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2013${runId}`.slice(0, 14), `فني بوابة ${runId}`,
    ]);
    const [fresh] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status) VALUES ($1,$2,'new','pending') RETURNING id`,
      [u.id, `GATE${runId}`.slice(0, 20)],
    );
    const [admin] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2014${runId}`.slice(0, 14), `موظف ${runId}`,
    ]);
    const [superAdmin] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2015${runId}`.slice(0, 14), `سوبر ${runId}`,
    ]);
    const [role] = await q(`SELECT id FROM roles WHERE is_super_admin = true AND deleted_at IS NULL LIMIT 1`);
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [superAdmin.id, role.id]);
    try {
      await expect(build(true).approve(admin.id, fresh.id)).rejects.toMatchObject({ status: 409 });
      await expect(build(true).approve(admin.id, fresh.id, undefined, 'سبب كافي للاستثناء')).rejects.toMatchObject({ status: 403 });
      await expect(build(true).approve(superAdmin.id, fresh.id, undefined, 'قصير')).rejects.toMatchObject({ status: 400 });
      const approved = await build(true).approve(superAdmin.id, fresh.id, undefined, 'فني خبرة ١٠ سنين، هيمتحن الأسبوع ده');
      expect(approved.profile.verificationStatus).toBe('approved');
      expect(approved.profile.verificationNotes).toContain('اعتماد استثنائي');

      // البوابة مقفولة (الافتراضي) ⇒ نفس السلوك القديم بالظبط
      await q(`UPDATE technician_profiles SET verification_status = 'pending', verification_notes = NULL WHERE id = $1`, [fresh.id]);
      const normal = await build(false).approve(admin.id, fresh.id);
      expect(normal.profile.verificationStatus).toBe('approved');
    } finally {
      await q(`DELETE FROM user_roles WHERE user_id = $1`, [superAdmin.id]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [fresh.id]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[u.id, admin.id, superAdmin.id]]);
    }
  });
});
