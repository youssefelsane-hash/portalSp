import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../../common/decorators/public.decorator';
import { DbPoolMonitorService } from '../../../database/db-pool-monitor.service';

/**
 * مهلة الـping. الغرض إن `/health` **يرد دايمًا** حتى والـpool متخنوق — الرد بحالة `degraded`
 * وفيه أرقام الـpool أنفع بمراحل من طلب بيعلّق للأبد (اللي هو بالظبط اللي حصل وقت العطل).
 */
const PING_TIMEOUT_MS = 3_000;

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly pool: DbPoolMonitorService,
  ) {}

  @Public()
  @Get()
  async check() {
    const isDatabaseUp = this.dataSource.isInitialized && (await this.pingDatabase());
    const pool = this.pool.snapshot();
    return {
      status: isDatabaseUp ? 'ok' : 'degraded',
      database: isDatabaseUp ? 'up' : 'down',
      // بيتعرض دايمًا: لما القاعدة تبان «down» والـpool فيه انتظار، ده الفرق بين «Postgres واقع»
      // و«Postgres شغّال بس مفيش اتصال فاضي» — عطلين مختلفين تمامًا بنفس العَرَض.
      pool,
      timestamp: new Date().toISOString(),
    };
  }

  private async pingDatabase(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ping timeout')), PING_TIMEOUT_MS);
        timer.unref?.();
      });
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
