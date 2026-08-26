import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { CrewParticipant, CrewShare, splitCrewEarnings } from './crew-earning-split';
import { OrderEarningShare } from './entities/order-earning-share.entity';

/**
 * حصص الطاقم من مستحقات الشغلانة (ADR-0040، docs/08 §63.أ3).
 *
 * الخدمة دي **بتحسب وبتسجّل الحصص بس** — حركة الفلوس نفسها بتفضل في `settleAndComplete()`
 * عشان كل حركة محفظة في التسوية تفضل في مكان واحد مقروء.
 */
@Injectable()
export class CrewEarningsService {
  private readonly logger = new Logger(CrewEarningsService.name);

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

    return rows.map((r) => ({
      technicianId: r.technician_id,
      participantRole: r.participant_role,
      technicianLevel: r.technician_level,
      // مستوى بلا صف إعدادات (بيانات ناقصة) بياخد وزن محايد بدل ما يتشال من التوزيع خالص.
      shareWeight: r.share_weight !== null ? Number(r.share_weight) : 1,
    }));
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
