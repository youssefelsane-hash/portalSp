import { Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { CrewParticipant, CrewShare, splitCrewEarnings } from './crew-earning-split';
import { OrderEarningShare } from './entities/order-earning-share.entity';

/**
 * حصص الطاقم من مستحقات الشغلانة (ADR-0040، docs/08 §63.أ3).
 *
 * الخدمة دي **بتحسب وبتسجّل الحصص بس** — حركة الفلوس نفسها بتفضل في `settleAndComplete()`
 * عشان كل حركة محفظة في التسوية تفضل في مكان واحد مقروء.
 */
/**
 * نسبة حصة المساعد لو الإعداد مش متاح (الخدمة متركّبة بإيد في اختبارات قديمة، أو الإعداد اتمسح).
 * نفس قيمة migration 0200 بالحرف — مصدرين للرقم ده ممنوع يختلفوا.
 */
export const DEFAULT_ASSISTANT_SHARE_RATIO = 0.65;

@Injectable()
export class CrewEarningsService {
  private readonly logger = new Logger(CrewEarningsService.name);

  constructor(@Optional() private readonly settingsService?: SettingsService) {}

  /**
   * ADR-0043 / docs/08 §66 — المساعد بياخد نسبة من اللي الفني بياخده في **نفس المستوى**.
   *
   * الإعداد قابل للتعديل من الأدمن، وبيتلجم في مدى معقول هنا كمان مش في الـmigration بس: إعداد
   * غلط (سالب، أو أكبر من 1) معناه المساعد بياخد أكتر من الفني — انعكاس كامل للمعنى، ومينفعش
   * يعدّي لمجرد إن حد كتب رقم غلط في لوحة الإعدادات.
   */
  private async assistantShareRatio(): Promise<number> {
    const raw =
      (await this.settingsService?.getNumber('crew.assistant_share_ratio', DEFAULT_ASSISTANT_SHARE_RATIO)) ??
      DEFAULT_ASSISTANT_SHARE_RATIO;
    if (!Number.isFinite(raw)) return DEFAULT_ASSISTANT_SHARE_RATIO;
    return Math.min(1, Math.max(0.1, raw));
  }

  /**
   * بيجمع المشاركين (القائد + `order_team_members`) بأوزان مستوياتهم **وقت التنفيذ**.
   *
   * استعلام واحد بـUNION بدل استعلامين — التسوية جوّه ترانزاكشن وكل رحلة للداتابيز بتطوّل القفل.
   */
  async resolveParticipants(manager: EntityManager, order: Order): Promise<CrewParticipant[]> {
    if (!order.technicianId) return [];

    interface Row {
      technician_id: string;
      participant_role: 'leader' | 'team_member' | 'assistant';
      technician_level: string;
      share_weight: string | null;
    }
    const rows = await manager.query<Row[]>(
      `SELECT tp.id AS technician_id, 'leader' AS participant_role, tp.current_level AS technician_level,
              lc.crew_share_weight AS share_weight
         FROM technician_profiles tp
         LEFT JOIN technician_level_config lc ON lc.level = tp.current_level
        WHERE tp.id = $1
       UNION ALL
       SELECT tp.id, otm.member_type, tp.current_level, lc.crew_share_weight
         FROM order_team_members otm
         JOIN technician_profiles tp ON tp.id = otm.technician_id
         LEFT JOIN technician_level_config lc ON lc.level = tp.current_level
        WHERE otm.order_id = $2 AND otm.technician_id <> $1`,
      [order.technicianId, order.id],
    );

    const assistantRatio = await this.assistantShareRatio();
    return rows.map((r) => {
      // مستوى بلا صف إعدادات (بيانات ناقصة) بياخد وزن محايد بدل ما يتشال من التوزيع خالص.
      const levelWeight = r.share_weight !== null ? Number(r.share_weight) : 1;
      // ADR-0043 — الوزن الفعّال = وزن المستوى × معامل الدور. المساعد أقل من الفني في **نفس**
      // المستوى، والمستوى لسه بيفرق بين مساعد ومساعد. الوزن الفعّال هو اللي بيتسجّل في
      // `order_earning_shares.share_weight` لأنه هو اللي حرّك القسمة فعلاً — السجل لازم يفسّر
      // الرقم اللي نزل المحفظة.
      const roleMultiplier = r.participant_role === 'assistant' ? assistantRatio : 1;
      return {
        technicianId: r.technician_id,
        participantRole: r.participant_role,
        technicianLevel: r.technician_level,
        shareWeight: levelWeight * roleMultiplier,
      };
    });
  }

  /**
   * بيحسب الحصص ويكتبها كـsnapshot. بيرجّع القايمة عشان الكولر يعمل حركات المحافظ.
   *
   * `ON CONFLICT DO NOTHING` على `(order_id, technician_id)`: التسوية مفروض تحصل مرة واحدة، بس
   * لو حصل إعادة تنفيذ (retry بعد فشل جزئي) مش عايزين نضاعف صفوف ولا نكسر التسوية كلها.
   */
  async recordShares(manager: EntityManager, order: Order, poolCents: number): Promise<CrewShare[]> {
    const participants = await this.resolveParticipants(manager, order);
    if (participants.length === 0) return [];

    const shares = splitCrewEarnings(poolCents, participants);
    for (const share of shares) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(OrderEarningShare)
        .values({
          orderId: order.id,
          technicianId: share.technicianId,
          participantRole: share.participantRole,
          technicianLevel: share.technicianLevel,
          shareWeight: share.shareWeight.toFixed(2),
          poolCents: Math.max(0, poolCents),
          shareCents: share.shareCents,
        })
        .orIgnore()
        .execute();
    }

    if (shares.length > 1) {
      this.logger.log(
        `توزيع مستحقات الطلب ${order.orderNumber} على ${shares.length} مشاركين: ` +
          shares.map((s) => `${s.participantRole}=${s.shareCents}`).join(', '),
      );
    }
    return shares;
  }

  /** حصص طلب واحد — للعرض عند الأدمن وفي تطبيق الفني. */
  listForOrder(manager: EntityManager, orderId: string): Promise<OrderEarningShare[]> {
    return manager.find(OrderEarningShare, { where: { orderId }, order: { shareCents: 'DESC' } });
  }
}
