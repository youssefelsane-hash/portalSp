import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { SettingsService } from '../settings/settings.service';

/**
 * موافقة تلقائية على المراحل بعد انتهاء مهلة العميل (docs/01B مهمة A §10).
 * نفس فلسفة OrderAutoCancelService: setInterval بـPostgres مباشرة، مش BullMQ.
 *
 * القاعدة: لو مرحلة completed + العميل ما وافقش/ما رفضش خلال `projects.milestone_auto_approve_hours`
 * → approval_status = approved تلقائيًا (بس لو payment_status = paid عشان مايطلقش مستحق غير محصل).
 */
@Injectable()
export class MilestoneAutoApproveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MilestoneAutoApproveService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(ProjectMilestone) private readonly milestones: Repository<ProjectMilestone>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) =>
        this.logger.error('فشل sweep الموافقة التلقائية للمراحل', err instanceof Error ? err.stack : err));
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const hours = await this.settingsService.getNumber('projects.milestone_auto_approve_hours', 72);
    const result = await this.dataSource.query<{ id: string }[] | [{ id: string }[], number]>(
      `WITH candidates AS (
         SELECT m.id
         FROM project_milestones m
         WHERE m.execution_status = 'completed'
           AND m.approval_status = 'pending'
           AND m.payment_status = 'paid'
           AND m.updated_at <= now() - ($1::int * interval '1 hour')
         ORDER BY m.sequence_number
         LIMIT 50
         FOR UPDATE OF m SKIP LOCKED
       )
       UPDATE project_milestones
       SET approval_status = 'approved', approved_by_customer = false,
           approved_at = now(), updated_at = now()
       FROM candidates c
       WHERE project_milestones.id = c.id
       RETURNING c.id`,
      [Math.round(hours)],
    );
    const rows = Array.isArray(result[0]) ? result[0] : result;
    if (rows.length > 0) this.logger.log(`موافقة تلقائية: ${rows.length} مرحلة`);
    return rows.length;
  }
}
