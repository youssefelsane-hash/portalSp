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
