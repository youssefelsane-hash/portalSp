import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * **كاشفات إشارات المخاطر** (ADR-0085) — بتقرا من النظام القايم وبتكتب في `risk_signals` بس.
 *
 * ## القواعد الحاكمة لكل كاشف هنا
 *
 * **١. مقارنة بالأقران، مش عتبة مطلقة.** «زوّد السعر في ٦١٪ من طلباته» مش رقم له معنى لوحده —
 * ممكن يكون شغله معقّد. اللي له معنى إن أقرانه في **نفس فئة الخدمة** وسيطهم ٨–١٢٪. العتبة
 * المطلقة بتعاقب الفئات الصعبة وبتسيب الفئات السهلة.
 *
 * **٢. حراسات ضد الاتهام الظالم.** تلات حراسات على كل كاشف مقارن، وكلها مقصودة:
 *   - `MIN_ACTOR_ORDERS`: مش بنحكم على حد من طلبين.
 *   - `MIN_PEER_SAMPLE`: وسيط مبني على ٢ أقران مش وسيط.
 *   - `EXCESS_RATIO`: لازم يعدّي الوسيط بفارق معتبر، مش بنقطة عشرية.
 *   الحراسات دي هي الفرق بين شاشة بتشتغل وشاشة بتولّد ضوضاء الناس بتتعلم تتجاهلها.
 *
 * **٣. الدليل بيتخزّن مع الإشارة.** كل صف بياخد `evidence` فيه القيمة المقاسة ووسيط الأقران
 * وحجم العيّنة. من غير كده الواجهة بتعرض «مشبوه» بلا سبب، وده مرفوض في ADR-0085 §2.
 *
 * **٤. إعادة التشغيل آمنة.** `dedupe_key` فريد لكل (نوع + فاعل + نافذة)، والكتابة
 * `ON CONFLICT DO UPDATE` — فالكاشف ممكن يشتغل كل ساعة بلا ما يكرر أو يمسح حكم مراجع.
 */
@Injectable()
export class RiskDetectorService {
  private readonly logger = new Logger(RiskDetectorService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** نافذة الرصد الافتراضية — الاضمحلال بيتكفّل بالأقدم، فمفيش داعي نرصد أبعد من كده. */
  private static readonly WINDOW_DAYS = 90;
  /** أقل عدد طلبات للشخص قبل ما نحكم على نمطه. */
  private static readonly MIN_ACTOR_ORDERS = 4;
  /** أقل عدد أقران عشان الوسيط يبقى وسيط. */
  private static readonly MIN_PEER_SAMPLE = 4;

  /**
   * بيشغّل كل الكاشفات وبيكتب اللي طلع منها.
   *
   * كل كاشف في `try` لوحده عن قصد: كاشف واحد بيقع (بيانات ناقصة، عمود اتغيّر) مايوقفش الباقي.
   * مركز مخاطر بيرجّع ٥ إشارات من ٦ أحسن بكتير من واحد بيرجّع خطأ.
   */
  async runAllDetectors(windowDays = RiskDetectorService.WINDOW_DAYS): Promise<{
    detector: string;
    inserted: number;
    error?: string;
  }[]> {
    const detectors: [string, (days: number) => Promise<number>][] = [
      ['price_increase_rate_vs_peers', (d) => this.detectPriceIncreaseRate(d)],
      ['quote_above_expected_range', (d) => this.detectQuoteAboveExpectedRange(d)],
      ['parts_cost_above_peers', (d) => this.detectPartsCostAbovePeers(d)],
      ['parts_without_receipt', (d) => this.detectPartsWithoutReceipt(d)],
      ['accept_then_cancel', (d) => this.detectAcceptThenCancel(d)],
      ['late_cancellation_after_acceptance', (d) => this.detectLateCancellation(d)],
      ['contact_then_cancel', (d) => this.detectContactThenCancel(d)],
      ['customer_churn_after_cancel', (d) => this.detectCustomerChurnAfterCancel(d)],
      ['refund_rate_above_peers', (d) => this.detectRefundRateAbovePeers(d)],
      ['complaint_rate_above_peers', (d) => this.detectComplaintRateAbovePeers(d)],
      ['complaints_against_actor', (d) => this.detectComplaintsAgainstActor(d)],
      ['repeat_pair_concentration', (d) => this.detectRepeatPairConcentration(d)],
    ];

    const results: { detector: string; inserted: number; error?: string }[] = [];
    for (const [name, run] of detectors) {
      try {
        results.push({ detector: name, inserted: await run(windowDays) });
      } catch (err) {
        this.logger.error(`كاشف ${name} وقع: ${err instanceof Error ? err.message : String(err)}`);
        results.push({ detector: name, inserted: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  /**
   * الكتابة الموحّدة: `ON CONFLICT (dedupe_key)` بيحدّث الدليل ولحظة الوقوع، **ومابيلمسش الحكم**.
   *
   * ده مقصود: مراجع قال «مشروعة» من أسبوع، والكاشف بيشتغل كل ساعة — لو الكتابة صفّرت الحكم،
   * الشاشة كانت هتجادل موظفيها كل ساعة وتضيّع شغلهم.
   */
  private async upsertSignals(rows: {
    actorUserId: string;
    actorType: string;
    signalTypeCode: string;
    orderId?: string | null;
    occurredAt: Date;
    evidence: Record<string, unknown>;
    weightOverride?: number | null;
    dedupeKey: string;
  }[]): Promise<number> {
    if (rows.length === 0) return 0;
    let written = 0;
    for (const row of rows) {
      await this.dataSource.query(
        `INSERT INTO risk_signals
           (actor_user_id, actor_type, signal_type_code, order_id, occurred_at, evidence, weight_override, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT (dedupe_key) DO UPDATE
           SET evidence = EXCLUDED.evidence,
               occurred_at = EXCLUDED.occurred_at,
               weight_override = EXCLUDED.weight_override,
               updated_at = now()`,
        [row.actorUserId, row.actorType, row.signalTypeCode, row.orderId ?? null, row.occurredAt,
         JSON.stringify(row.evidence), row.weightOverride ?? null, row.dedupeKey],
      );
      written += 1;
    }
    return written;
  }

  /** مفتاح تكرار ثابت لكل (نوع + فاعل + نافذة) — النافذة بالشهر عشان الإشارة تتجدد شهريًا. */
  private windowKey(code: string, actorUserId: string, windowDays: number): string {
    const month = new Date().toISOString().slice(0, 7);
    return `${code}:${actorUserId}:${windowDays}d:${month}`;
  }

  // ════════════════════ ١) إساءة التسعير ════════════════════

  /**
   * نسبة الطلبات اللي الفني زوّد فيها الفلوس، مقابل **وسيط أقرانه في نفس فئة الخدمة**.
   *
   * «زوّد» = ضاف بند `spare_part`/`extra_labor` بنفسه. البنود اللي الأدمن ضافها مستثناة —
   * دي مش أفعال الفني.
   */
  private async detectPriceIncreaseRate(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; category_id: string; orders: string; raised: string;
      raise_pct: string; peer_median_pct: string; peer_count: string;
    }[]>(
      `WITH scoped AS (
         SELECT o.id, o.technician_id, s.category_id,
                EXISTS (
                  SELECT 1 FROM order_items oi
                   WHERE oi.order_id = o.id
                     AND oi.item_type IN ('spare_part','extra_labor')
                     AND oi.added_by_user_id = tu.id
                ) AS raised
           FROM orders o
           JOIN services s ON s.id = o.service_id
           JOIN technician_profiles tp ON tp.id = o.technician_id
           JOIN users tu ON tu.id = tp.user_id
          WHERE o.technician_id IS NOT NULL
            AND o.deleted_at IS NULL
            AND o.created_at > now() - ($1 || ' days')::interval
       ), per_actor AS (
         SELECT tp.user_id AS actor_user_id, sc.category_id,
                COUNT(*)::int AS orders,
                SUM(sc.raised::int)::int AS raised,
                100.0 * SUM(sc.raised::int) / COUNT(*) AS raise_pct
           FROM scoped sc
           JOIN technician_profiles tp ON tp.id = sc.technician_id
          GROUP BY 1, 2
         HAVING COUNT(*) >= $2
       ), peers AS (
         SELECT category_id,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY raise_pct) AS peer_median_pct,
                COUNT(*)::int AS peer_count
           FROM per_actor GROUP BY 1
       )
       SELECT a.actor_user_id, a.category_id, a.orders::text, a.raised::text,
              ROUND(a.raise_pct::numeric, 1)::text AS raise_pct,
              ROUND(p.peer_median_pct::numeric, 1)::text AS peer_median_pct,
              p.peer_count::text
         FROM per_actor a JOIN peers p ON p.category_id = a.category_id
        WHERE p.peer_count >= $3
          AND a.raise_pct > 20
          -- **ضعف الوسيط + ١٠ نقاط**: نسبة أعلى شوية مش شذوذ. الشرطين مع بعض بيمنعوا
          -- إنذار كاذب لما الوسيط نفسه صغير جدًا (وسيط ٢٪ × ٢ = ٤٪ عتبة بلا معنى).
          AND a.raise_pct >= GREATEST(p.peer_median_pct * 2, p.peer_median_pct + 10)`,
      [String(windowDays), RiskDetectorService.MIN_ACTOR_ORDERS, RiskDetectorService.MIN_PEER_SAMPLE],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'price_increase_rate_vs_peers',
      occurredAt: new Date(),
      evidence: {
        measured_pct: Number(row.raise_pct),
        peer_median_pct: Number(row.peer_median_pct),
        peer_count: Number(row.peer_count),
        orders_in_window: Number(row.orders),
        orders_with_increase: Number(row.raised),
        window_days: windowDays,
        category_id: row.category_id,
      },
      dedupeKey: `price_increase_rate_vs_peers:${row.actor_user_id}:${row.category_id}:${new Date().toISOString().slice(0, 7)}`,
    })));
  }

  /**
   * عرض سعر فوق **النطاق اللي النظام نفسه حسبه** (`order_quotes.expected_max_cents`).
   *
   * ده أقوى إشارة تسعير عندنا لأنها مش مقارنة بالأقران أصلاً — دي مقارنة بتقدير المنصة
   * للشغلانة دي بعينها. إشارة لكل عرض على حدة (مش مجمّعة) عشان المراجع يفتح الطلب ويشوف.
   */
  private async detectQuoteAboveExpectedRange(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; order_id: string; quote_id: string; amount_cents: string;
      expected_max_cents: string; excess_pct: string; created_at: Date; diagnosis: string | null;
    }[]>(
      `SELECT tu.id AS actor_user_id, q.order_id, q.id AS quote_id,
              q.amount_cents::text, q.expected_max_cents::text,
              ROUND((100.0 * (q.amount_cents - q.expected_max_cents) / NULLIF(q.expected_max_cents, 0))::numeric, 1)::text AS excess_pct,
              q.created_at, q.diagnosis
         FROM order_quotes q
         JOIN users tu ON tu.id = q.submitted_by_user_id
        WHERE q.created_at > now() - ($1 || ' days')::interval
          AND q.expected_max_cents IS NOT NULL
          AND q.expected_max_cents > 0
          -- ٢٥٪ فوق السقف المتوقع: هامش معقول للتقدير، واللي فوقه محتاج كلمتين تفسير.
          AND q.amount_cents > q.expected_max_cents * 1.25`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'quote_above_expected_range',
      orderId: row.order_id,
      occurredAt: row.created_at,
      evidence: {
        quoted_cents: Number(row.amount_cents),
        expected_max_cents: Number(row.expected_max_cents),
        excess_pct: Number(row.excess_pct),
        // التشخيص المكتوب بيتعرض للمراجع: تفسير مقنع بيحوّل الإشارة لـ«مشروعة» في ثانية.
        diagnosis: row.diagnosis,
        has_diagnosis: Boolean(row.diagnosis && row.diagnosis.trim().length >= 10),
      },
      dedupeKey: `quote_above_expected_range:${row.quote_id}`,
    })));
  }

  // ════════════════════ ٢) التلاعب بقطع الغيار ════════════════════

  private async detectPartsCostAbovePeers(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; category_id: string; orders: string; avg_parts_cents: string;
      peer_median_cents: string; peer_count: string;
    }[]>(
      `WITH per_actor AS (
         SELECT tp.user_id AS actor_user_id, s.category_id,
                COUNT(DISTINCT o.id)::int AS orders,
                COALESCE(SUM(oi.total_price_cents), 0)::numeric / COUNT(DISTINCT o.id) AS avg_parts_cents
           FROM orders o
           JOIN services s ON s.id = o.service_id
           JOIN technician_profiles tp ON tp.id = o.technician_id
           LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.item_type = 'spare_part'
          WHERE o.technician_id IS NOT NULL AND o.deleted_at IS NULL
            AND o.created_at > now() - ($1 || ' days')::interval
          GROUP BY 1, 2
         HAVING COUNT(DISTINCT o.id) >= $2
       ), peers AS (
         SELECT category_id,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_parts_cents) AS peer_median_cents,
                COUNT(*)::int AS peer_count
           FROM per_actor GROUP BY 1
       )
       SELECT a.actor_user_id, a.category_id, a.orders::text,
              ROUND(a.avg_parts_cents)::text AS avg_parts_cents,
              ROUND(p.peer_median_cents)::text AS peer_median_cents, p.peer_count::text
         FROM per_actor a JOIN peers p ON p.category_id = a.category_id
        WHERE p.peer_count >= $3
          AND p.peer_median_cents > 0
          AND a.avg_parts_cents >= p.peer_median_cents * 1.75
          -- حد أدنى مطلق (٢٠٠ ج.م): فرق ٧٥٪ على وسيط ٢٠ جنيه مش قصة.
          AND a.avg_parts_cents >= 20000`,
      [String(windowDays), RiskDetectorService.MIN_ACTOR_ORDERS, RiskDetectorService.MIN_PEER_SAMPLE],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'parts_cost_above_peers',
      occurredAt: new Date(),
      evidence: {
        avg_parts_cents: Number(row.avg_parts_cents),
        peer_median_cents: Number(row.peer_median_cents),
        excess_pct: Math.round((Number(row.avg_parts_cents) / Number(row.peer_median_cents) - 1) * 100),
        peer_count: Number(row.peer_count),
        orders_in_window: Number(row.orders),
        window_days: windowDays,
        category_id: row.category_id,
      },
      dedupeKey: `parts_cost_above_peers:${row.actor_user_id}:${row.category_id}:${new Date().toISOString().slice(0, 7)}`,
    })));
  }

  /** بنود قطع غيار معتمدة بلا صورة إيصال — العميل دفع بلا أي إثبات شراء. */
  private async detectPartsWithoutReceipt(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; items_without_receipt: string; total_items: string;
      total_cents: string; last_occurred_at: Date;
    }[]>(
      `SELECT oi.added_by_user_id AS actor_user_id,
              COUNT(*) FILTER (WHERE oi.receipt_photo_url IS NULL)::text AS items_without_receipt,
              COUNT(*)::text AS total_items,
              COALESCE(SUM(oi.total_price_cents) FILTER (WHERE oi.receipt_photo_url IS NULL), 0)::text AS total_cents,
              MAX(oi.created_at) AS last_occurred_at
         FROM order_items oi
         JOIN users u ON u.id = oi.added_by_user_id
        WHERE oi.item_type = 'spare_part'
          AND oi.created_at > now() - ($1 || ' days')::interval
          AND u.user_type = 'technician'
        GROUP BY 1
       HAVING COUNT(*) FILTER (WHERE oi.receipt_photo_url IS NULL) >= 3
          AND COALESCE(SUM(oi.total_price_cents) FILTER (WHERE oi.receipt_photo_url IS NULL), 0) >= 50000`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'parts_without_receipt',
      occurredAt: row.last_occurred_at,
      evidence: {
        items_without_receipt: Number(row.items_without_receipt),
        total_parts_items: Number(row.total_items),
        uncovered_amount_cents: Number(row.total_cents),
        window_days: windowDays,
      },
      dedupeKey: this.windowKey('parts_without_receipt', row.actor_user_id, windowDays),
    })));
  }

  // ════════════════════ ٣) إساءة استخدام الطلبات ════════════════════

  private async detectAcceptThenCancel(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; cancellations: string; accepted_orders: string;
      cancel_pct: string; last_occurred_at: Date;
    }[]>(
      `WITH cancels AS (
         SELECT c.technician_user_id AS actor_user_id, COUNT(*)::int AS cancellations,
                MAX(c.cancelled_at) AS last_occurred_at
           FROM technician_order_cancellations c
          WHERE c.cancelled_at > now() - ($1 || ' days')::interval
          GROUP BY 1
       ), accepted AS (
         SELECT tp.user_id AS actor_user_id, COUNT(*)::int AS accepted_orders
           FROM orders o
           JOIN technician_profiles tp ON tp.id = o.technician_id
          WHERE o.created_at > now() - ($1 || ' days')::interval AND o.deleted_at IS NULL
          GROUP BY 1
       )
       SELECT c.actor_user_id, c.cancellations::text,
              COALESCE(a.accepted_orders, 0)::text AS accepted_orders,
              ROUND(100.0 * c.cancellations / NULLIF(COALESCE(a.accepted_orders, 0) + c.cancellations, 0), 1)::text AS cancel_pct,
              c.last_occurred_at
         FROM cancels c LEFT JOIN accepted a ON a.actor_user_id = c.actor_user_id
        WHERE c.cancellations >= 3`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'accept_then_cancel',
      occurredAt: row.last_occurred_at,
      evidence: {
        cancellations: Number(row.cancellations),
        accepted_orders: Number(row.accepted_orders),
        cancel_pct: Number(row.cancel_pct ?? 0),
        window_days: windowDays,
      },
      dedupeKey: this.windowKey('accept_then_cancel', row.actor_user_id, windowDays),
    })));
  }

  /** إلغاء بعد أكتر من ساعتين من القبول — الوقت اللي كان ممكن يتلاقى فيه بديل ضاع. */
  private async detectLateCancellation(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; late_cancels: string; avg_hours: string; last_occurred_at: Date;
    }[]>(
      `SELECT c.technician_user_id AS actor_user_id,
              COUNT(*)::text AS late_cancels,
              ROUND(AVG(c.elapsed_seconds_after_acceptance) / 3600.0, 1)::text AS avg_hours,
              MAX(c.cancelled_at) AS last_occurred_at
         FROM technician_order_cancellations c
        WHERE c.cancelled_at > now() - ($1 || ' days')::interval
          AND c.elapsed_seconds_after_acceptance > 7200
        GROUP BY 1
       HAVING COUNT(*) >= 2`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'late_cancellation_after_acceptance',
      occurredAt: row.last_occurred_at,
      evidence: {
        late_cancellations: Number(row.late_cancels),
        avg_hours_after_acceptance: Number(row.avg_hours),
        window_days: windowDays,
      },
      dedupeKey: this.windowKey('late_cancellation_after_acceptance', row.actor_user_id, windowDays),
    })));
  }

  // ════════════════════ ٤) تسريب خارج المنصة (مؤشر مش اتهام) ════════════════════

  /**
   * الفني بعت رسائل للعميل، وبعدها بساعة أو أقل ألغى الطلب.
   *
   * **ده مؤشر مش إثبات** (ADR-0085 §6): نفس النمط بيحصل بحسن نية (اتكلموا فاكتشف إنه مش هيقدر
   * يوصل). عشان كده الوزن متوسط والوصف بيقول «مؤشر»، والتأكيد محتاج إنسان.
   */
  private async detectContactThenCancel(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; incidents: string; last_occurred_at: Date; sample_order_id: string;
    }[]>(
      `WITH contact_cancels AS (
         SELECT c.technician_user_id AS actor_user_id, c.order_id, c.cancelled_at,
                (SELECT COUNT(*) FROM chat_messages m
                   JOIN chat_threads t ON t.id = m.thread_id
                  WHERE t.order_id = c.order_id
                    AND m.sender_user_id = c.technician_user_id
                    AND m.created_at < c.cancelled_at) AS messages_sent
           FROM technician_order_cancellations c
          WHERE c.cancelled_at > now() - ($1 || ' days')::interval
       )
       SELECT actor_user_id, COUNT(*)::text AS incidents,
              MAX(cancelled_at) AS last_occurred_at,
              (ARRAY_AGG(order_id ORDER BY cancelled_at DESC))[1] AS sample_order_id
         FROM contact_cancels
        WHERE messages_sent >= 1
        GROUP BY 1
       HAVING COUNT(*) >= 2`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'contact_then_cancel',
      orderId: row.sample_order_id,
      occurredAt: row.last_occurred_at,
      evidence: {
        incidents: Number(row.incidents),
        window_days: windowDays,
        note: 'مؤشر على اتفاق خارج المنصة — مش إثبات. التأكيد محتاج شكوى أو رسالة صريحة أو اعتراف.',
      },
      dedupeKey: this.windowKey('contact_then_cancel', row.actor_user_id, windowDays),
    })));
  }

  /** عملاء ألغى لهم الفني وما رجعوش يحجزوا خالص بعدها. */
  private async detectCustomerChurnAfterCancel(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; churned: string; total_cancelled_customers: string; last_occurred_at: Date;
    }[]>(
      `WITH cancelled_customers AS (
         SELECT DISTINCT c.technician_user_id AS actor_user_id, o.customer_id, c.cancelled_at
           FROM technician_order_cancellations c
           JOIN orders o ON o.id = c.order_id
          WHERE c.cancelled_at > now() - ($1 || ' days')::interval
            -- **بنستنى ١٤ يوم قبل ما نقول «العميل مشي»**: عميل ألغى له امبارح ولسه ماحجزش
            -- مش «توقّف عن الحجز» — ده وقت طبيعي بين حجزين.
            AND c.cancelled_at < now() - interval '14 days'
       ), churn AS (
         SELECT cc.actor_user_id, cc.customer_id, cc.cancelled_at,
                NOT EXISTS (
                  SELECT 1 FROM orders o2
                   WHERE o2.customer_id = cc.customer_id
                     AND o2.created_at > cc.cancelled_at
                     AND o2.deleted_at IS NULL
                ) AS churned
           FROM cancelled_customers cc
       )
       SELECT actor_user_id,
              COUNT(*) FILTER (WHERE churned)::text AS churned,
              COUNT(*)::text AS total_cancelled_customers,
              MAX(cancelled_at) AS last_occurred_at
         FROM churn
        GROUP BY 1
       HAVING COUNT(*) FILTER (WHERE churned) >= 2`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'customer_churn_after_cancel',
      occurredAt: row.last_occurred_at,
      evidence: {
        churned_customers: Number(row.churned),
        cancelled_customers: Number(row.total_cancelled_customers),
        churn_pct: Math.round((Number(row.churned) / Number(row.total_cancelled_customers)) * 100),
        window_days: windowDays,
        note: 'مؤشر — العميل ممكن يكون بطّل يستخدم المنصة لأي سبب تاني.',
      },
      dedupeKey: this.windowKey('customer_churn_after_cancel', row.actor_user_id, windowDays),
    })));
  }

  // ════════════════════ ٥) إساءة استخدام من العميل ════════════════════

  private async detectRefundRateAbovePeers(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; refunds: string; orders: string; refund_pct: string;
      peer_median_pct: string; peer_count: string; last_occurred_at: Date;
    }[]>(
      `WITH per_customer AS (
         SELECT cu.user_id AS actor_user_id,
                COUNT(DISTINCT o.id)::int AS orders,
                COUNT(DISTINCT r.id)::int AS refunds,
                100.0 * COUNT(DISTINCT r.id) / COUNT(DISTINCT o.id) AS refund_pct,
                MAX(r.requested_at) AS last_occurred_at
           FROM orders o
           JOIN customer_profiles cu ON cu.id = o.customer_id
           LEFT JOIN refunds r ON r.order_id = o.id AND r.refund_status IN ('completed','processing','approved')
          WHERE o.created_at > now() - ($1 || ' days')::interval AND o.deleted_at IS NULL
          GROUP BY 1
         HAVING COUNT(DISTINCT o.id) >= $2
       ), peers AS (
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY refund_pct) AS peer_median_pct,
                COUNT(*)::int AS peer_count
           FROM per_customer
       )
       SELECT c.actor_user_id, c.refunds::text, c.orders::text,
              ROUND(c.refund_pct::numeric, 1)::text AS refund_pct,
              ROUND(p.peer_median_pct::numeric, 1)::text AS peer_median_pct,
              p.peer_count::text, c.last_occurred_at
         FROM per_customer c CROSS JOIN peers p
        WHERE p.peer_count >= $3
          AND c.refunds >= 2
          AND c.refund_pct >= GREATEST(p.peer_median_pct * 2, p.peer_median_pct + 20)`,
      [String(windowDays), RiskDetectorService.MIN_ACTOR_ORDERS, RiskDetectorService.MIN_PEER_SAMPLE],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'customer',
      signalTypeCode: 'refund_rate_above_peers',
      occurredAt: row.last_occurred_at ?? new Date(),
      evidence: {
        refunds: Number(row.refunds),
        orders_in_window: Number(row.orders),
        refund_pct: Number(row.refund_pct),
        peer_median_pct: Number(row.peer_median_pct),
        peer_count: Number(row.peer_count),
        window_days: windowDays,
      },
      dedupeKey: this.windowKey('refund_rate_above_peers', row.actor_user_id, windowDays),
    })));
  }

  private async detectComplaintRateAbovePeers(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; complaints: string; orders: string; complaint_pct: string;
      peer_median_pct: string; peer_count: string; last_occurred_at: Date;
    }[]>(
      `WITH per_customer AS (
         SELECT cu.user_id AS actor_user_id,
                COUNT(DISTINCT o.id)::int AS orders,
                COUNT(DISTINCT cp.id)::int AS complaints,
                100.0 * COUNT(DISTINCT cp.id) / COUNT(DISTINCT o.id) AS complaint_pct,
                MAX(cp.created_at) AS last_occurred_at
           FROM orders o
           JOIN customer_profiles cu ON cu.id = o.customer_id
           LEFT JOIN complaints cp ON cp.order_id = o.id AND cp.filed_by_user_id = cu.user_id
          WHERE o.created_at > now() - ($1 || ' days')::interval AND o.deleted_at IS NULL
          GROUP BY 1
         HAVING COUNT(DISTINCT o.id) >= $2
       ), peers AS (
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY complaint_pct) AS peer_median_pct,
                COUNT(*)::int AS peer_count
           FROM per_customer
       )
       SELECT c.actor_user_id, c.complaints::text, c.orders::text,
              ROUND(c.complaint_pct::numeric, 1)::text AS complaint_pct,
              ROUND(p.peer_median_pct::numeric, 1)::text AS peer_median_pct,
              p.peer_count::text, c.last_occurred_at
         FROM per_customer c CROSS JOIN peers p
        WHERE p.peer_count >= $3
          AND c.complaints >= 3
          AND c.complaint_pct >= GREATEST(p.peer_median_pct * 2, p.peer_median_pct + 25)`,
      [String(windowDays), RiskDetectorService.MIN_ACTOR_ORDERS, RiskDetectorService.MIN_PEER_SAMPLE],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'customer',
      signalTypeCode: 'complaint_rate_above_peers',
      occurredAt: row.last_occurred_at ?? new Date(),
      evidence: {
        complaints_filed: Number(row.complaints),
        orders_in_window: Number(row.orders),
        complaint_pct: Number(row.complaint_pct),
        peer_median_pct: Number(row.peer_median_pct),
        peer_count: Number(row.peer_count),
        window_days: windowDays,
      },
      dedupeKey: this.windowKey('complaint_rate_above_peers', row.actor_user_id, windowDays),
    })));
  }

  /** شكاوى **ضد** الشخص — بتشتغل على الفني والعميل بنفس المنطق. */
  private async detectComplaintsAgainstActor(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; user_type: string; complaints: string; upheld: string; last_occurred_at: Date;
    }[]>(
      `SELECT cp.against_user_id AS actor_user_id, u.user_type::text,
              COUNT(*)::text AS complaints,
              COUNT(*) FILTER (WHERE cp.resolution_type IS NOT NULL
                                 AND cp.resolution_type::text <> 'rejected')::text AS upheld,
              MAX(cp.created_at) AS last_occurred_at
         FROM complaints cp
         JOIN users u ON u.id = cp.against_user_id
        WHERE cp.created_at > now() - ($1 || ' days')::interval
          AND cp.against_user_id IS NOT NULL
        GROUP BY 1, 2
       HAVING COUNT(*) >= 2`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: row.user_type === 'customer' ? 'customer' : 'technician',
      signalTypeCode: 'complaints_against_actor',
      occurredAt: row.last_occurred_at,
      evidence: {
        complaints_against: Number(row.complaints),
        upheld: Number(row.upheld),
        window_days: windowDays,
      },
      dedupeKey: this.windowKey('complaints_against_actor', row.actor_user_id, windowDays),
    })));
  }

  // ════════════════════ ٦) تواطؤ / احتيال ════════════════════

  /**
   * تركّز غير طبيعي بين فني وعميل بعينه.
   *
   * عميل بيحب صنايعي ويطلبه تاني **حاجة كويسة** — عشان كده العتبة عالية (٧٠٪ من الطلبات
   * ومعاها ٤ طلبات على الأقل مع نفس الطرف). اللي بيفرّق: الحجم + النسبة مع بعض.
   */
  private async detectRepeatPairConcentration(windowDays: number): Promise<number> {
    const rows = await this.dataSource.query<{
      actor_user_id: string; counterparty_user_id: string; pair_orders: string;
      total_orders: string; concentration_pct: string; last_occurred_at: Date;
    }[]>(
      `WITH pairs AS (
         SELECT tp.user_id AS actor_user_id, cu.user_id AS counterparty_user_id,
                COUNT(*)::int AS pair_orders, MAX(o.created_at) AS last_occurred_at
           FROM orders o
           JOIN technician_profiles tp ON tp.id = o.technician_id
           JOIN customer_profiles cu ON cu.id = o.customer_id
          WHERE o.created_at > now() - ($1 || ' days')::interval AND o.deleted_at IS NULL
          GROUP BY 1, 2
       ), totals AS (
         SELECT actor_user_id, SUM(pair_orders)::int AS total_orders FROM pairs GROUP BY 1
       )
       SELECT p.actor_user_id, p.counterparty_user_id, p.pair_orders::text,
              t.total_orders::text,
              ROUND(100.0 * p.pair_orders / t.total_orders, 1)::text AS concentration_pct,
              p.last_occurred_at
         FROM pairs p JOIN totals t ON t.actor_user_id = p.actor_user_id
        WHERE t.total_orders >= 5
          AND p.pair_orders >= 4
          AND 100.0 * p.pair_orders / t.total_orders >= 70`,
      [String(windowDays)],
    );

    return this.upsertSignals(rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorType: 'technician',
      signalTypeCode: 'repeat_pair_concentration',
      occurredAt: row.last_occurred_at,
      evidence: {
        counterparty_user_id: row.counterparty_user_id,
        pair_orders: Number(row.pair_orders),
        total_orders: Number(row.total_orders),
        concentration_pct: Number(row.concentration_pct),
        window_days: windowDays,
        note: 'عميل بيطلب صنايعي بعينه تاني حاجة طبيعية — الإشارة بتتفتح عند الحجم والنسبة مع بعض.',
      },
      dedupeKey: `repeat_pair_concentration:${row.actor_user_id}:${row.counterparty_user_id}:${new Date().toISOString().slice(0, 7)}`,
    })));
  }
}
