import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** لقطة حالة الـpool — نفس عدّادات node-postgres، متسمّية بوضوح. */
export interface DbPoolSnapshot {
  /** اتصالات مفتوحة دلوقتي (مشغولة + خاملة). */
  total: number;
  /** اتصالات مفتوحة ومش مستخدمة — جاهزة فورًا. */
  idle: number;
  /** طلبات **مستنية** اتصال. أي رقم فوق الصفر لفترة = ضغط حقيقي؛ ده العدّاد المهم. */
  waiting: number;
  /** السقف المضبوط. */
  max: number;
}

/** كام تِك متتالي فيه انتظار قبل ما نتكلم — تِك واحد بيحصل في أي طفرة عادية. */
const PRESSURE_TICKS_BEFORE_WARNING = 3;

const SAMPLE_INTERVAL_MS = 10_000;

/** اتصالات بنفترض إنها محجوزة للصيانة/الـmigrations/الـpsql اليدوي — مش للتطبيق. */
const MAINTENANCE_CONNECTIONS_RESERVE = 10;

/**
 * **مراقب ضغط الـpool.**
 *
 * وقت العطل الحقيقي، الـAPI كان بيطبع «Nest application successfully started» وبعدين مايردش
 * على أي طلب، **من غير سطر واحد في اللوج يقول ليه**. الاستنزاف مكانش ليه أي صوت: الطلبات
 * بتستنى اتصال مش جاي، والانتظار في node-postgres صامت.
 *
 * الخدمة دي بتدّي الحالة دي صوت: بتاخد عيّنة كل عشر ثواني، وتتكلم لما يبقى فيه انتظار فعلي
 * مستمر — مش عند أول طفرة. ولما الضغط يروح بتقول كده مرة واحدة، عشان اللوج يبقى فيه بداية
 * ونهاية للحادثة بدل تكرار بلا خلاص.
 */
@Injectable()
export class DbPoolMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbPoolMonitorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private pressureTicks = 0;
  private warned = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
    void this.reportCapacityAtBoot();
  }

  /**
   * بيطبع وقت الإقلاع **الرقمين اللي بيحكموا سعة التزامن الحقيقية**: سقف الـpool بتاع النسخة
   * دي، و`max_connections` بتاع Postgres نفسه.
   *
   * السبب: `DATABASE_POOL_MAX` كان ١٠ لشهور وهو سقف فعلي على عدد العملاء اللي يقدروا يحجزوا
   * في نفس اللحظة (٧٠٪ من ٤٠ حجز متزامن كانوا بياخدوا 503 — راجع `config/configuration.ts`).
   * محدش كان بيشوف الرقم ده في أي مكان، فمكانش فيه أي إشارة إن ده هو القيد. دلوقتي بيبان في
   * أول عشر سطور من لوج الإقلاع، ومعاه القاعدة اللي بتحسب الرقم الصح.
   *
   * الفشل هنا **مايوقّفش الإقلاع أبدًا**: ده قياس مساعد، والتطبيق بيشتغل من غيره عادي.
   */
  private async reportCapacityAtBoot(): Promise<void> {
    const snapshot = this.snapshot();
    const poolMax = snapshot?.max ?? 0;
    try {
      const [row] = await this.dataSource.query<{ max_connections: string }[]>(`SHOW max_connections`);
      const serverMax = parseInt(row?.max_connections ?? '0', 10);
      if (!serverMax || !poolMax) return;

      const instancesAffordable = Math.floor((serverMax - MAINTENANCE_CONNECTIONS_RESERVE) / poolMax);
      this.logger.log(
        `سعة الاتصالات: pool النسخة دي ${poolMax}، و max_connections بتاع Postgres ${serverMax} — ` +
          `يعني القاعدة دي تستحمل ${instancesAffordable} نسخة من التطبيق بالسقف ده ` +
          `(بعد حجز ${MAINTENANCE_CONNECTIONS_RESERVE} اتصال للصيانة والـmigrations).`,
      );
      if (instancesAffordable < 1) {
        this.logger.error(
          `DATABASE_POOL_MAX=${poolMax} أكبر من اللي القاعدة تستحمله (${serverMax} اتصال). ` +
            `نسخة واحدة ممكن تستهلك كل الاتصالات وتمنع الصيانة والـmigrations. صغّر السقف أو كبّر القاعدة.`,
        );
      }
    } catch (err) {
      this.logger.warn(`تعذّر قياس سعة اتصالات القاعدة وقت الإقلاع: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * بيقرا عدّادات الـpool الحقيقية من درايفر TypeORM.
   *
   * بيرجّع `null` لو الشكل الداخلي اتغيّر في نسخة جاية — قياس مش متاح أهون من انهيار، والصحة
   * نفسها مالهاش تعتمد على تفصيلة داخلية في مكتبة.
   */
  snapshot(): DbPoolSnapshot | null {
    const pool = (this.dataSource.driver as { master?: unknown }).master as
      | { totalCount?: number; idleCount?: number; waitingCount?: number; options?: { max?: number } }
      | undefined;
    if (!pool || typeof pool.totalCount !== 'number') return null;
    return {
      total: pool.totalCount,
      idle: pool.idleCount ?? 0,
      waiting: pool.waitingCount ?? 0,
      max: pool.options?.max ?? 0,
    };
  }

  private sample(): void {
    const s = this.snapshot();
    if (!s) return;

    if (s.waiting > 0) {
      this.pressureTicks += 1;
      if (this.pressureTicks >= PRESSURE_TICKS_BEFORE_WARNING && !this.warned) {
        this.warned = true;
        this.logger.error(
          `ضغط على pool القاعدة: ${s.waiting} طلب مستني، ${s.total}/${s.max} اتصال مفتوح، ${s.idle} خامل. ` +
            `لو الرقم ده مستمر، فيه شغل ماسك اتصالات وهي مستنية اتصالات تانية — راجع أي كود بيمسك ` +
            `QueryRunner لمدة طويلة.`,
        );
      }
      return;
    }

    if (this.warned) {
      this.logger.log(`ضغط pool القاعدة راح: ${s.total}/${s.max} اتصال مفتوح، ${s.idle} خامل.`);
    }
    this.pressureTicks = 0;
    this.warned = false;
  }
}
