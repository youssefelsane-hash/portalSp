import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { LoyaltyDirection, LoyaltySource, LoyaltyTransaction } from './entities/loyalty-transaction.entity';

/** نفس فلسفة `QuoteExpiryService`/`OrderAutoCancelService`: فحص دوري بسيط، مش BullMQ repeatable. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** سقف مستخدمين لكل دورة — الدورة الجاية بتكمّل، فمفيش دفعة عملاقة بتقفل الاتصال. */
const SWEEP_USER_BATCH = 200;

interface DueLot {
  id: string;
  points: number;
  cumulativeBefore: number;
}

/**
 * انتهاء صلاحية نقاط الولاء (تدقيق L-6).
 *
 * الحالة قبل كده: `expires_at` و`loyalty_direction='expire'` موجودين في المخطّط من أول يوم، ومفيش
 * أي كود بيكتب فيهم — كل النداءات بتمرّر `expiresAt = null` ومفيش أي sweep. يعني الرصيد بيتراكم
 * للأبد: التزام مالي على الشركة بيكبر بلا سقف، وسياسة صلاحية معلنة في المخطّط ومش منفّذة.
 *
 * ## نموذج الحساب — FIFO على الدفعات
 *
 * `redeem()` بيخصم من الرصيد الإجمالي، مش من دفعة بعينها، فمفيش ربط مباشر بين استهلاك ودفعة.
 * الربط بيتحسب هنا وقت الفحص بقاعدة واحدة صريحة: **الاستهلاك بياكل الأقدم الأول**.
 *
 * ```
 * consumed        = Σ|redeem| + Σ|expire|            (كل اللي خرج من الرصيد)
 * cumulativeBefore = Σ الدفعات الأقدم من الدفعة دي
 * remaining(lot)   = clamp(lot.points − max(0, consumed − cumulativeBefore), 0, lot.points)
 * ```
 *
 * الخاصية اللي بتخلّي ده متماسك: `Σ remaining = Σ earn − consumed = الرصيد الحالي`. وكل عملية
 * انتهاء بتكتب صف `expire` فبتدخل في `consumed` بتاع الدورة الجاية — يعني الحساب مايتكررش.
 *
 * `expired_at` بتتحط على الدفعة حتى لو اللي فضل فيها صفر (كانت مستهلكة بالكامل)، عشان الدورة
 * الجاية ماتفحصهاش تاني.
 *
 * ## العميل لازم يعرف
 *
 * رصيد بينقص من غير سبب ظاهر = بلاغ دعم. فكل انتهاء فعلي (> 0) بيبعت إشعار بالرقم اللي انتهى
 * والرصيد الجديد. الإشعار best-effort: فشله مايرجّعش الترانزاكشن — الانتهاء نفسه حصل فعلاً.
 */
@Injectable()
export class LoyaltyExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoyaltyExpiryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'loyalty-expiry', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** بيرجّع إجمالي النقاط اللي انتهت فعلاً في الدورة دي. */
  async sweep(): Promise<number> {
    const users = await this.dataSource.query<{ user_id: string }[]>(
      `SELECT DISTINCT user_id
       FROM loyalty_transactions
       WHERE direction = 'earn' AND expires_at IS NOT NULL AND expired_at IS NULL AND expires_at <= now()
       LIMIT $1`,
      [SWEEP_USER_BATCH],
    );

    let totalExpired = 0;
    for (const { user_id: userId } of users) {
      try {
        totalExpired += await this.expireForUser(userId);
      } catch (err) {
        // مستخدم واحد بيفشل مايوقّفش الدورة كلها — نفس فلسفة كل الـsweeps التانية.
        this.logger.error(`فشل انتهاء نقاط المستخدم ${userId}`, err instanceof Error ? err.stack : err);
      }
    }
    if (totalExpired > 0) {
      this.logger.log(`انتهت ${totalExpired} نقطة ولاء عبر ${users.length} عميل`);
    }
    return totalExpired;
  }

  async expireForUser(userId: string): Promise<number> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      // نفس قفل `LoyaltyService` بالظبط — أي earn/redeem متزامن بيستنى، فالرصيد اللي بنحسب
      // عليه هو الرصيد اللحظي مش صورة قديمة.
      const profile = await manager
        .createQueryBuilder(CustomerProfile, 'c')
        .setLock('pessimistic_write')
        .where('c.user_id = :userId', { userId })
        .getOne();
      if (!profile) return null;

      const dueLots = await this.findDueLots(manager, userId);
      if (dueLots.length === 0) return null;

      const consumed = await this.consumedPoints(manager, userId);
      let expiring = 0;
      for (const lot of dueLots) {
        const alreadyEaten = Math.max(0, consumed - lot.cumulativeBefore);
        expiring += Math.max(0, Math.min(lot.points, lot.points - alreadyEaten));
      }

      // كل الدفعات المستحقّة اتفحصت، حتى اللي فضل فيها صفر — مايرجعوش تاني في أي دورة.
      await manager.query(`UPDATE loyalty_transactions SET expired_at = now() WHERE id = ANY($1::uuid[])`, [
        dueLots.map((l) => l.id),
      ]);

      if (expiring <= 0) return null;

      // شبكة أمان: الرصيد هو الحقيقة النهائية. لو أي انحراف تاريخي خلّى الحساب أكبر من الرصيد،
      // بنقصّه بدل ما نخلّي الرصيد بالسالب.
      const points = Math.min(expiring, profile.loyaltyPointsBalance);
      if (points <= 0) return null;

      const balanceAfter = profile.loyaltyPointsBalance - points;
      await manager.update(CustomerProfile, { id: profile.id }, { loyaltyPointsBalance: balanceAfter });
      await manager.save(
        manager.create(LoyaltyTransaction, {
          userId,
          pointsAmount: -points,
          direction: LoyaltyDirection.EXPIRE,
          source: LoyaltySource.PROMOTION,
          referenceId: null,
          balanceAfter,
        }),
      );
      return { points, balanceAfter };
    });

    if (!outcome) return 0;
    await this.notifyExpired(userId, outcome.points, outcome.balanceAfter);
    return outcome.points;
  }

  /** الدفعات المستحقّة + مجموع الدفعات الأقدم منها (نافذة تراكمية بترتيب FIFO). */
  private async findDueLots(manager: EntityManager, userId: string): Promise<DueLot[]> {
    const rows = await manager.query<{ id: string; points: string; cumulative_before: string }[]>(
      `SELECT id, points, cumulative_before FROM (
         SELECT id, points_amount AS points, expires_at, expired_at,
                COALESCE(SUM(points_amount) OVER (ORDER BY created_at, id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS cumulative_before
         FROM loyalty_transactions
         WHERE user_id = $1 AND direction = 'earn'
       ) lots
       WHERE expires_at IS NOT NULL AND expired_at IS NULL AND expires_at <= now()
       ORDER BY cumulative_before`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      points: Number(r.points),
      cumulativeBefore: Number(r.cumulative_before),
    }));
  }

  /** كل اللي خرج من الرصيد قبل الدورة دي: استبدالات + انتهاءات سابقة. */
  private async consumedPoints(manager: EntityManager, userId: string): Promise<number> {
    const [row] = await manager.query<{ consumed: string }[]>(
      `SELECT COALESCE(-SUM(points_amount), 0) AS consumed
       FROM loyalty_transactions
       WHERE user_id = $1 AND direction IN ('redeem', 'expire')`,
      [userId],
    );
    return Number(row?.consumed ?? 0);
  }

  private async notifyExpired(userId: string, points: number, balanceAfter: number): Promise<void> {
    try {
      await this.notifications.notify(
        {
          userId,
          notificationType: 'loyalty_points_expired',
          titleAr: 'انتهت صلاحية نقاط ولاء',
          bodyAr: `انتهت صلاحية ${points} نقطة من نقاط الولاء بتاعتك. رصيدك الحالي ${balanceAfter} نقطة.`,
          deepLink: '/loyalty',
        },
        NotificationChannel.IN_APP,
      );
    } catch (err) {
      // الانتهاء نفسه اتسجّل خلاص — فشل الإشعار مايستاهلش يرجّع عملية مالية صحيحة.
      this.logger.warn(`تعذّر إشعار العميل ${userId} بانتهاء نقاطه: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
