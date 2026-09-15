import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  calculateEarningsV2,
  EarningRole,
  EarningsCalculationResult,
  EarningsParticipantInput,
} from './earnings-calculator';
import { splitOrderRevenue } from '../pricing/commission-base';

interface ResolvedPolicyRow {
  technician_id: string;
  participant_role: 'leader' | 'team_member' | 'assistant';
  technician_kind: EarningRole;
  technician_level: string;
  level_weight_bps: number | string;
  assistant_ratio_bps: number | string;
  service_skill: string;
  service_skill_factor_bps: number | string;
  individual_adjustment_bps: number | string | null;
  order_adjustment_bps: number | string | null;
  used_neutral_skill_fallback: boolean;
}

/** Resolves every mutable admin policy into the immutable input consumed by the V2 calculator. */
@Injectable()
export class EarningsPolicyService {
  constructor(private readonly dataSource: DataSource) {}

  async calculateOrder(
    orderId: string,
    finalOrderTotalCents: number,
    manager: EntityManager = this.dataSource.manager,
    lockOrder = false,
  ): Promise<EarningsCalculationResult> {
    const orderRows: Array<{
      settlement_policy_version: number | string;
      commission_rate_applied: number | string | null;
      commissionable_base_cents: number | string | null;
    }> = await manager.query(
      `SELECT settlement_policy_version, commission_rate_applied, commissionable_base_cents
         FROM orders
        WHERE id = $1
        ${lockOrder ? 'FOR UPDATE' : ''}`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order) throw new Error('Order not found while resolving V2 earnings policy');
    if (Number(order.settlement_policy_version) !== 2) {
      throw new Error('Earnings Policy V2 cannot settle a V1 order');
    }
    if (order.commission_rate_applied == null) {
      throw new Error('Earnings order is missing its platform commission percentage snapshot');
    }

    const participants = await this.resolveParticipants(orderId, manager);
    const commissionRatePercentage = Number(order.commission_rate_applied);
    if (!Number.isFinite(commissionRatePercentage) || commissionRatePercentage < 0 || commissionRatePercentage > 100) {
      throw new Error('Earnings order has an invalid platform commission percentage snapshot');
    }
    // **ADR-0037 / docs/08 §60.1**: النسبة بتتطبّق على **وعاء العمولة** مش على الإجمالي.
    // الإجمالي بيضم مكوّنات الشركة وحدها بتتحمّل مخاطرها (الضمان الاختياري، رسوم الطوارئ،
    // مضاعف التضخم). حساب `الإجمالي × النسبة` هنا كان بيرجّع الفني لنصيب من سعر الضمان —
    // بالظبط البلاغ اللي الـADR اتكتب عشانه، وكان راجع بصمت مع تحويل التسوية للنسخة v2.
    // `commissionable_base_cents` = null معناه طلب قبل migration 0192، فبنرجع للإجمالي عمدًا
    // عشان إعادة تسوية طلب قديم ما تديش نتيجة مختلفة عن تسويته الأصلية.
    const commissionableBaseCents =
      order.commissionable_base_cents == null ? finalOrderTotalCents : Number(order.commissionable_base_cents);
    const { platformCommissionCents } = splitOrderRevenue({
      totalAmountCents: finalOrderTotalCents,
      commissionableBaseCents,
      commissionRatePercentage,
    });
    return calculateEarningsV2(finalOrderTotalCents, platformCommissionCents, participants);
  }

  /**
   * بيحلّ كل سياسة قابلة للتعديل من الأدمن لمدخلات ثابتة تتحسب عليها الفلوس.
   *
   * ## أسبقية استثناء الشخص: ليه `IS NOT NULL` مش `= o.service_id`
   *
   * **تصليح بَقّة مالية حقيقية (تدقيق 2026-09-11).** الاستثناء العام على شخص بيتسجّل بـ
   * `service_id = NULL`، فـ`(NULL = o.service_id)` بتطلع **NULL** مش `false`. وPostgres في
   * `ORDER BY … DESC` بيحط الـNULLs **الأول** افتراضيًا — يعني الصف العام كان بيسبق الصف
   * المخصوص للخدمة ويغلبه.
   *
   * النتيجة المتقاسة حيًا: أدمن بيحط لفني استثناء **على خدمة بعينها** وهو عنده استثناء عام،
   * والنظام بيدفع بالعام في صمت (٥٪ بدل ٢٥٪ في القياس). مفيش أي رسالة خطأ — الفلوس بتتحسب
   * وتتوزّع وتتقفل على الرقم الغلط، وده أسوأ شكل للبَقّة المالية.
   *
   * `tea.service_id IS NOT NULL` **مستحيل تطلع NULL**، فالترتيب بقى قاطع. وهي مكافئة لـ«مطابق
   * للخدمة دي» بالظبط، لأن `WHERE` أصلاً بيحصر الصفوف على (خدمة الطلب أو NULL) — مفيش خدمة
   * تالتة تقدر تعدّي.
   */
  async resolveParticipants(
    orderId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<EarningsParticipantInput[]> {
    const rows: ResolvedPolicyRow[] = await manager.query(
      `WITH order_context AS (
         SELECT id, technician_id, service_id
           FROM orders
          WHERE id = $1
       ), participants AS (
         SELECT o.technician_id, 'leader'::varchar AS participant_role
           FROM order_context o
          WHERE o.technician_id IS NOT NULL
         UNION ALL
         SELECT otm.technician_id,
                CASE WHEN otm.member_type = 'assistant' THEN 'assistant' ELSE 'team_member' END
           FROM order_team_members otm
           JOIN order_context o ON o.id = otm.order_id
          WHERE otm.technician_id <> o.technician_id
       )
       SELECT p.technician_id,
              p.participant_role,
              tp.technician_kind,
              tp.current_level AS technician_level,
              tlc.earning_weight_bps AS level_weight_bps,
              COALESCE(slo.assistant_ratio_bps, tlc.assistant_ratio_bps) AS assistant_ratio_bps,
              COALESCE(ts.skill_level, 'standard'::skill_level) AS service_skill,
              COALESCE(sso.factor_bps, esp.factor_bps) AS service_skill_factor_bps,
              ia.adjustment_bps AS individual_adjustment_bps,
              oa.adjustment_bps AS order_adjustment_bps,
              (ts.id IS NULL) AS used_neutral_skill_fallback
         FROM participants p
         JOIN order_context o ON true
         JOIN technician_profiles tp ON tp.id = p.technician_id AND tp.deleted_at IS NULL
         JOIN technician_level_config tlc ON tlc.level = tp.current_level
         LEFT JOIN technician_services ts
           ON ts.technician_id = p.technician_id
          AND ts.service_id = o.service_id
          AND ts.is_active = true
          AND ts.verification_status = 'approved'
         LEFT JOIN earnings_skill_policy esp
           ON esp.skill_level = COALESCE(ts.skill_level, 'standard'::skill_level)
         LEFT JOIN service_earnings_level_overrides slo
           ON slo.service_id = o.service_id
          AND slo.technician_level = tp.current_level
         LEFT JOIN service_earnings_skill_overrides sso
           ON sso.service_id = o.service_id
          AND sso.skill_level = COALESCE(ts.skill_level, 'standard'::skill_level)
         LEFT JOIN LATERAL (
           SELECT tea.adjustment_bps
             FROM technician_earning_adjustments tea
            WHERE tea.technician_id = p.technician_id
              AND (tea.service_id = o.service_id OR tea.service_id IS NULL)
              AND tea.disabled_at IS NULL
              AND tea.effective_from <= now()
              AND (tea.effective_until IS NULL OR tea.effective_until > now())
            -- ترتيب الأسبقية: المخصوص للخدمة قبل العام. شوف تعليق الدالة فوق — الصيغة دي
            -- تصليح بَقّة مالية، مش أسلوب كتابة.
            ORDER BY (tea.service_id IS NOT NULL) DESC, tea.effective_from DESC, tea.id DESC
            LIMIT 1
         ) ia ON true
         LEFT JOIN order_earning_adjustments oa
           ON oa.order_id = o.id
          AND oa.technician_id = p.technician_id
          AND oa.disabled_at IS NULL
        ORDER BY CASE p.participant_role WHEN 'leader' THEN 0 ELSE 1 END, p.technician_id`,
      [orderId],
    );

    return rows.map((row) => {
      // **ADR-0055 §3 بالحرف** (وثبّته ADR-0087): «القسمة بتشتغل على `participant_role` مش على
      // `technician_kind`»
      // — مساعد شايل الطلب لوحده بياخد **نصيب القائد الكامل**، لأنه عمل الشغلانة كلها وسعر
      // الخدمة هو سعرها. تسعيرة المساعد المخفّضة معناها «نصيبك كمساعِد لفني تاني»، مش سقف
      // دائم على أي فلوس ياخدها.
      //
      // السطر ده كان بيقرا `technician_kind` كمان، فالمساعد القائد كان بيطلع `earningRole`
      // = assistant مع `isLeader` = true — التركيبة اللي `calculateEarningsV2` بترفضها. النتيجة
      // المتقاسة حيًا: التسوية بترمي `PAY_003` والطلب بيتعلّق على `work_completed/unpaid`
      // **للأبد** — لا العميل يقدر يدفع، ولا المساعد بياخد حاجة، ولا المنصة بتاخد عمولتها.
      // ADR-0055 كان بيقول «مفيش سطر كود مالي اتغيّر» على أساس إن القسمة على الدور — والسطر
      // ده كان بالظبط هو الاستثناء اللي مالحقش يتشال وقتها.
      //
      // حماية المساعد **المنضم لطاقم حد تاني** مافقدتش: `resolveEffectiveMemberType` بيفرض
      // `member_type = 'assistant'` عليه وقت الضم، فبيوصل هنا بـ`participant_role = 'assistant'`
      // وياخد تسعيرة المساعد زي ما هي. والحارس في `calculateEarningsV2` لسه بيقفل على أي صف
      // بيانات مخالف (مساعد مسجّل `team_member` من غير ما يكون القائد).
      const earningRole: EarningRole = row.participant_role === 'assistant' ? 'assistant' : 'technician';
      return {
        technicianId: row.technician_id,
        earningRole,
        isLeader: row.participant_role === 'leader',
        technicianKindSnapshot: row.technician_kind,
        technicianLevel: row.technician_level,
        levelWeightBps: Number(row.level_weight_bps),
        assistantRatioBps: Number(row.assistant_ratio_bps),
        serviceSkill: row.service_skill,
        serviceSkillFactorBps: Number(row.service_skill_factor_bps),
        individualAdjustmentBps: Number(row.individual_adjustment_bps ?? 0),
        orderAdjustmentBps: Number(row.order_adjustment_bps ?? 0),
      };
    });
  }
}
