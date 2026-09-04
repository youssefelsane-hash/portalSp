import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Installment } from '../installments/entities/installment.entity';
import { PaymentsService } from './payments.service';
import { SettingsService } from '../settings/settings.service';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 25;

/**
 * sweep تحصيل الأقساط المستحقة (migration 0177) — نفس فلسفة OrderAutoCancelService/
 * RecurringOrdersService بالحرف: setInterval يعيد الاستعلام من Postgres كل دقيقة، مش BullMQ
 * repeatable job (سبب موثق: بَقّة worker recovery بعد انقطاع Redis طويل — technicians/README.md).
 *
 * **المطالبة ذرّية** (`FOR UPDATE SKIP LOCKED`): scheduler يت执行 مرتين أو workerين متوازيين
 * مابياخدوش نفس القسط. والتحصيل نفسه idempotent على مستوى الدفعة:
 * `installment:{id}:{attempt}` unique — أي تكرار بيترجع بدل ما ينشئ شحنة تانية.
 *
 * **مطفأ افتراضيًا**: `installments.auto_collection_enabled=false` لحد ما قدرة provider على
 * التحصيل المتكرر تتأكد ضد البوابة الحقيقية — مطفي = الأقساط بتفضل مجدولة مرئية (BLOCKED
 * عمليًا) بدل أي سلوك مفبرك.
 */
@Injectable()
export class InstallmentCollectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstallmentCollectionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Installment) private readonly installments: Repository<Installment>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly paymentsService: PaymentsService,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) =>
        this.logger.error('فشل sweep تحصيل الأقساط', err instanceof Error ? err.stack : err),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(options?: { installmentIds?: string[] }): Promise<number> {
    const enabled = await this.settingsService.getBoolean('installments.auto_collection_enabled', false);
    if (!enabled) return 0;
    const maxAttemptsSetting = await this.settingsService.getNumber('installments.max_auto_attempts', 3);
    const maxAttempts = Math.max(1, Math.round(maxAttemptsSetting));
    const backoffDays = Math.max(
      0,
      Math.round(await this.settingsService.getNumber('installments.retry_backoff_days', 3)),
    );

    // claim ذرّي — scheduled → processing. الفشل المبكر (بلا كارت/بوابة غير مدعومة) بينزل
    // الحالة failed داخل attemptInstallmentCharge نفسه؛ الـretry بيرجع عبر الـbackoff تحت.
    const claimed = await this.claimDue(SWEEP_BATCH_SIZE, maxAttempts, backoffDays, options?.installmentIds);

    let dispatched = 0;
    for (const row of claimed) {
      try {
        await this.paymentsService.attemptInstallmentCharge(row.id);
        dispatched += 1;
      } catch (err) {
        // إرجاع القسط failed قابل لإعادة المحاولة — مش processing عالق
        await this.dataSource
          .query(
            `UPDATE installments SET status = 'failed', last_error = $2, updated_at = now()
             WHERE id = $1 AND status = 'processing'`,
            [row.id, err instanceof Error ? err.message : String(err)],
          )
          .catch(() => undefined);
        this.logger.error(`فشل تحصيل القسط ${row.id}`, err instanceof Error ? err.stack : err);
      }
    }

    if (dispatched > 0) this.logger.log(`الأقساط: ${dispatched} محاولة تحصيل اتجهزت`);
    return dispatched;
  }

  private async claimDue(limit: number, maxAttempts: number, backoffDays: number, installmentIds?: string[]): Promise<{ id: string }[]> {
    // المستحقات: مجدولة وصل موعدها، أو فاشلة خلصت مهلة الـbackoff — الاتنين بشرط المحاولات < السقف.
    // attempt_count بيترفع هنا (جوه نفس قفل الـclaim) عشان العد دقيق حتى لو النداء انهار بعده.
    const result = await this.dataSource.query<{ id: string }[] | [{ id: string }[], number]>(
      `WITH candidates AS (
         SELECT i.id
         FROM installments i
         JOIN installment_applications a ON a.id = i.application_id
         WHERE i.attempt_count < $2
           -- $4 نطاق اختياري للاختبارات بس (NULL في الإنتاج) — نفس نمط باقي الـsweeps في
           -- المشروع. من غيره، spec متوازي بيسحب أقساط spec تاني فعدّاد المحاولات بيطلع
           -- 3 بدل 2، والفشل بيتقري كأنه كسر في ضمان SKIP LOCKED وهو تلوّث بين الاختبارات.
           AND ($4::uuid[] IS NULL OR i.id = ANY($4::uuid[]))
           AND a.status = 'approved'
           AND a.deleted_at IS NULL
           AND (
             (i.status = 'scheduled' AND i.due_at <= now())
             OR
             (i.status = 'failed' AND i.last_attempt_at <= now() - ($3::integer * interval '1 day'))
             OR
             -- استرداد claim معلّق (انهار worker وسط التحصيل): نصف ساعة كافية كـlease
             (i.status = 'processing' AND (i.last_attempt_at IS NULL OR i.last_attempt_at <= now() - interval '30 minutes'))
           )
         ORDER BY i.due_at, i.id
         LIMIT $1
         FOR UPDATE OF i SKIP LOCKED
       )
       UPDATE installments
       SET status = 'processing',
           attempt_count = installments.attempt_count + 1,
           updated_at = now()
       WHERE id IN (SELECT id FROM candidates)
       RETURNING id`,
      [limit, maxAttempts, backoffDays, installmentIds ?? null],
    );
    return Array.isArray(result[0]) ? (result[0] as { id: string }[]) : (result as { id: string }[]);
  }
}
