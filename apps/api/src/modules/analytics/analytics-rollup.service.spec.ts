import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { AnalyticsRollupService } from './analytics-rollup.service';

/**
 * إحصائيات-٦ — التجميع اليومي والاحتفاظ (ADR-0081 §4).
 *
 * **الاختبار اللي بيهم هو اللي بيشغّل الدورة مرتين.** التجميع اللي بيعدّي مرة مش بيثبت حاجة —
 * السؤال الحقيقي هو: لو الدورة اتشغّلت تاني (إعادة تشغيل، نسختين، فحص يدوي)، الأرقام بتتضاعف
 * ولا بتفضل زي ما هي؟ ده بالظبط الفرق بين «عدّاد بيتزوّد» (فئة البَقّة اللي المشروع اتلسع
 * منها تلات مرات) و«رقم بيتعاد حسابه».
 */
describe('AnalyticsRollupService — تجميع الفنل والاحتفاظ (ADR-0081 §4) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: AnalyticsRollupService;

  const runId = Date.now().toString(36);
  const sessions = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ];
  const eventIds: string[] = [];
  /** أيام التجميع اللي الاختبار ده لمسها — التنضيف بيمسحها هي بس. */
  const touchedDays = new Set<string>();

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /** احتفاظ ثابت في الاختبار عشان نتحكم في اللي بيتمسح. */
  let retentionDays = 180;
  const settings = {
    getNumber: async (_key: string, _fallback: number) => retentionDays,
  } as unknown as SettingsService;

  async function addEvent(opts: {
    stage: string;
    session: string;
    daysAgo: number;
    outcome?: 'success' | 'failed';
  }): Promise<void> {
    const [row] = await q<{ id: string }[]>(
      `INSERT INTO booking_funnel_events (stage, source, outcome, failure_reason, funnel_session_id, occurred_at)
       VALUES ($1, 'client', $2, $3, $4, now() - ($5 || ' days')::interval)
       RETURNING id`,
      [
        opts.stage,
        opts.outcome ?? 'success',
        opts.outcome === 'failed' ? `test_${runId}` : null,
        opts.session,
        String(opts.daysAgo),
      ],
    );
    eventIds.push(row.id);
  }

  const dailyRow = async (stage: string) => {
    const rows = await q<{ day: string; sessions: number; events: number; failed_events: number }[]>(
      `SELECT day::text AS day, sessions, events, failed_events
         FROM booking_funnel_daily
        WHERE stage = $1 AND day = (now() AT TIME ZONE 'Africa/Cairo')::date`,
      [stage],
    );
    return rows[0] ?? null;
  };

  /**
   * الأرقام اللي كانت موجودة **قبل** ما الاختبار يضيف أي حاجة.
   *
   * `booking_funnel_daily` جدول مجمّع لكل المنصة — مفيش فيه بُعد جلسة يتفلتر بيه. فلو
   * الاختبار قاس القيمة المطلقة، أي حدث تاني في نفس اليوم (تدقيق حي، تشغيلة سابقة، تطوير
   * عادي) بيكسره وهو سليم — وده حصل فعلاً. القياس بقى على **الفرق** اللي الاختبار نفسه
   * أحدثه، فالنتيجة بقت مستقلة عن حالة القاعدة.
   */
  const baseline = new Map<string, { sessions: number; events: number; failed: number }>();

  async function snapshotBaseline(stage: string): Promise<void> {
    const row = await dailyRow(stage);
    baseline.set(stage, {
      sessions: Number(row?.sessions ?? 0),
      events: Number(row?.events ?? 0),
      failed: Number(row?.failed_events ?? 0),
    });
  }

  const addedBy = async (stage: string) => {
    const row = await dailyRow(stage);
    const base = baseline.get(stage) ?? { sessions: 0, events: 0, failed: 0 };
    return {
      sessions: Number(row?.sessions ?? 0) - base.sessions,
      events: Number(row?.events ?? 0) - base.events,
      failed: Number(row?.failed_events ?? 0) - base.failed,
    };
  };

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();
    service = new AnalyticsRollupService(dataSource, settings);

    const [today] = await q<{ d: string }[]>(`SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS d`);
    touchedDays.add(today.d);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await q(`DELETE FROM booking_funnel_events WHERE id = ANY($1)`, [eventIds]);
    // بنمسح صفوف التجميع اللي اتلمست ونعيد بناءها من الأحداث الباقية — عشان مانسيبش أرقام
    // فيها بيانات الاختبار في قاعدة التطوير.
    if (touchedDays.size > 0) {
      await q(`DELETE FROM booking_funnel_daily WHERE day = ANY($1::date[])`, [[...touchedDays]]);
      await service.rollupRecentDays(3);
    }
    await dataSource.destroy();
  });

  describe('التجميع', () => {
    it('بيجمّع الجلسات المميّزة والأحداث والفشل لكل مرحلة', async () => {
      await snapshotBaseline('service_viewed');
      await snapshotBaseline('booking_started');
      // تلات جلسات شافوا الخدمة، واحدة منهم شافتها مرتين ⇒ ٣ جلسات و٤ أحداث **زيادة**.
      await addEvent({ stage: 'service_viewed', session: sessions[0], daysAgo: 0 });
      await addEvent({ stage: 'service_viewed', session: sessions[0], daysAgo: 0 });
      await addEvent({ stage: 'service_viewed', session: sessions[1], daysAgo: 0 });
      await addEvent({ stage: 'service_viewed', session: sessions[2], daysAgo: 0 });
      // واحدة منهم بدأت الحجز وفشلت.
      await addEvent({ stage: 'booking_started', session: sessions[0], daysAgo: 0, outcome: 'failed' });

      await service.rollupRecentDays(3);

      const viewed = await addedBy('service_viewed');
      expect(viewed.sessions).toBe(3);
      expect(viewed.events).toBe(4);
      expect(viewed.failed).toBe(0);

      const started = await addedBy('booking_started');
      expect(started.sessions).toBe(1);
      expect(started.failed).toBe(1);
    });

    it('**تشغيل الدورة تاني مابيضاعفش** — الرقم بيتعاد حسابه مش بيتزوّد', async () => {
      const before = await dailyRow('service_viewed');
      await service.rollupRecentDays(3);
      await service.rollupRecentDays(3);
      const after = await dailyRow('service_viewed');
      expect(Number(after?.events)).toBe(Number(before?.events));
      expect(Number(after?.sessions)).toBe(Number(before?.sessions));
    });

    it('حدث جديد على نفس اليوم بيظهر بعد إعادة التجميع من غير مسح يدوي', async () => {
      await addEvent({ stage: 'service_viewed', session: '00000000-0000-4000-8000-000000000004', daysAgo: 0 });
      await service.rollupRecentDays(3);
      const viewed = await addedBy('service_viewed');
      expect(viewed.sessions).toBe(4);
      expect(viewed.events).toBe(5);
    });
  });

  describe('الاحتفاظ', () => {
    it('بيمسح الأقدم من المدة وبيسيب اللي جوّاها', async () => {
      const oldSession = '00000000-0000-4000-8000-00000000000f';
      await addEvent({ stage: 'service_viewed', session: oldSession, daysAgo: 400 });
      const [day] = await q<{ d: string }[]>(
        `SELECT ((now() - interval '400 days') AT TIME ZONE 'Africa/Cairo')::date::text AS d`,
      );
      touchedDays.add(day.d);

      const survivesBefore = await q<{ c: string }[]>(
        `SELECT COUNT(*) AS c FROM booking_funnel_events WHERE funnel_session_id = $1`,
        [oldSession],
      );
      expect(Number(survivesBefore[0].c)).toBe(1);

      const purged = await service.purgeOldEvents();
      expect(purged).toBeGreaterThanOrEqual(1);

      const survivesAfter = await q<{ c: string }[]>(
        `SELECT COUNT(*) AS c FROM booking_funnel_events WHERE funnel_session_id = $1`,
        [oldSession],
      );
      expect(Number(survivesAfter[0].c)).toBe(0);

      // أحداث النهارده لسه موجودة — الحذف بالتاريخ مش مسح شامل.
      const today = await q<{ c: string }[]>(
        `SELECT COUNT(*) AS c FROM booking_funnel_events WHERE funnel_session_id = ANY($1)`,
        [sessions],
      );
      expect(Number(today[0].c)).toBeGreaterThan(0);
    });

    it('إعداد احتفاظ بصفر مابيمسحش السجل كله — الحد الأدنى أسبوع', async () => {
      const recentSession = '00000000-0000-4000-8000-0000000000aa';
      await addEvent({ stage: 'service_viewed', session: recentSession, daysAgo: 2 });
      const [day] = await q<{ d: string }[]>(
        `SELECT ((now() - interval '2 days') AT TIME ZONE 'Africa/Cairo')::date::text AS d`,
      );
      touchedDays.add(day.d);

      retentionDays = 0; // إعداد كارثي لو اتقبل زي ما هو
      await service.purgeOldEvents();
      retentionDays = 180;

      const survives = await q<{ c: string }[]>(
        `SELECT COUNT(*) AS c FROM booking_funnel_events WHERE funnel_session_id = $1`,
        [recentSession],
      );
      expect(Number(survives[0].c)).toBe(1);
    });
  });

  describe('القراءة التاريخية', () => {
    it('بترجّع صف لكل (يوم، مرحلة) في المدى', async () => {
      await service.rollupRecentDays(3);
      const rows = await service.historicalDaily(new Date(Date.now() - 86_400_000), new Date());
      const mine = rows.filter((r) => r.stage === 'service_viewed');
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(Number(mine[mine.length - 1].sessions)).toBeGreaterThanOrEqual(1);
    });
  });
});
