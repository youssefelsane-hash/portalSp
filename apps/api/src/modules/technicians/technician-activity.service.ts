import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';

export interface TechnicianActivitySnapshot {
  /** متصل دلوقتي عبر أي socket (تتبع/شات) — RealtimeSessionRegistry، in-memory بحت. */
  online: boolean;
  /** آخر نشاط حقيقي معروف — أحدث `refresh_tokens.last_seen_at` للمستخدم ده (أي جلسة، منتهية أو
   * لسه سارية) — `null` لو مفيش أي جلسة معروفة خالص. */
  lastActiveAt: Date | null;
}

/**
 * تتبع أونلاين/آخر نشاط (docs/08 §35.10، ADR-0021 §6) — **observability بحت، صفر استهلاك في
 * الأهلية/المطابقة**. القرار المعماري الأهم هنا: **صفر تخزين حالة جديد** — الاتنين بيتحسبوا من
 * مصادر حقيقة موجودة بالفعل بدل عمود/جدول جديد:
 *  - `online` من `RealtimeSessionRegistry` (in-memory، الـMap اللي `OrderTrackingGateway`/
 *    `ChatGateway` بيسجّلوا فيها أصلاً وقت الاتصال — صفر تعديل على الـgateways، بس قراءة).
 *  - `lastActiveAt` من `MAX(refresh_tokens.last_seen_at)` — العمود ده موجود ومتحدّث فعليًا في كل
 *    دورة تجديد access token (`AuthService.rotateRefreshToken`/`login`)، مفيش داعي "heartbeat"
 *    endpoint جديد أو عمود `technician_profiles.last_active_at` منفصل.
 *
 * راجع ADR-0021 §6 للتحذير الصريح: الحقلين دول **ميتفحصوش أبدًا** في أي مسار أهلية/مطابقة (نفس
 * قاعدة is_available/is_on_duty القديمة اللي اتشالت من الأهلية بالكامل من ADR-0017 — مفيش سبب
 * نكرر نفس الغلطة بحقل جديد بس بإسم مختلف).
 */
@Injectable()
export class TechnicianActivityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessionRegistry: RealtimeSessionRegistry,
  ) {}

  async getActivitySnapshot(userIds: string[]): Promise<Map<string, TechnicianActivitySnapshot>> {
    const result = new Map<string, TechnicianActivitySnapshot>();
    if (userIds.length === 0) return result;

    const rows = await this.dataSource.query<{ user_id: string; last_seen_at: Date }[]>(
      `SELECT user_id, MAX(last_seen_at) AS last_seen_at FROM refresh_tokens WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
      [userIds],
    );
    const lastSeenByUser = new Map(rows.map((r) => [r.user_id, r.last_seen_at]));

    for (const userId of userIds) {
      result.set(userId, {
        online: this.sessionRegistry.isUserOnline(userId),
        lastActiveAt: lastSeenByUser.get(userId) ?? null,
      });
    }
    return result;
  }

  async getActivityForUser(userId: string): Promise<TechnicianActivitySnapshot> {
    const snapshot = await this.getActivitySnapshot([userId]);
    return snapshot.get(userId) ?? { online: false, lastActiveAt: null };
  }
}
