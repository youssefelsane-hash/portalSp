import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UserType } from '../auth/entities/user.entity';
import { OpsMetricsService } from './ops-metrics.service';
import { ClientErrorsService } from './client-errors.service';
import { ClientErrorsQueryDto } from './dto/client-errors-query.dto';

/**
 * **نقطة القراءة الوحيدة للمراقبة الخارجية (ج-٧).**
 *
 * ليه تحت الأدمن مش عامة زي `/health`: الرد فيه أرقام تشغيلية حقيقية (طلبات عالقة، دفعات فاشلة،
 * أعماق الطوابير) — دي معلومات عن حجم الشغل والحالة، ماينفعش تبقى مكشوفة للإنترنت. `/health`
 * بيفضل عام لأنه liveness بس (شغّال/مش شغّال).
 *
 * **كيف تُستخدم في الإنتاج**: المراقبة بتندهها كل دقيقة بتوكن أدمن وقاعدة الإنذار واحدة:
 * `status != "ok"`. الحقل `alerts[]` فيه السبب بالعربي والرقم والعتبة، فالتنبيه نفسه بيبقى
 * قابل للتصرّف من غير ما حد يفتح الشاشة.
 */
@Controller('admin/ops')
@Roles(UserType.ADMIN)
export class AdminOpsController {
  constructor(
    private readonly metrics: OpsMetricsService,
    private readonly clientErrors: ClientErrorsService,
  ) {}

  @Get('health-metrics')
  @RequirePermission('operations.view')
  async healthMetrics() {
    return this.metrics.collect();
  }

  /**
   * **أخطاء الواجهة مجمّعة** (ADR-0114) — الرد على «٣٧ مستخدم حصل لهم Error عند اختيار الموعد
   * النهاردة». مجمّع بالبصمة ومرتّب بعدد الزوّار المتأثرين، مش سجل سطر سطر: السجل الخام بيتقرا
   * ساعة، والتجميع بيقول فين المشكلة في ثانية.
   *
   * نفس صلاحية `health-metrics` ولنفس السبب المكتوب فوق — أرقام تشغيلية مش للإنترنت.
   */
  @Get('client-errors')
  @RequirePermission('operations.view')
  async clientErrorSummary(@Query() query: ClientErrorsQueryDto) {
    const { from, to } = resolveClientErrorRange(query);
    const [rows, lastHour] = await Promise.all([
      this.clientErrors.summary(from, to, query.limit ?? 50),
      this.clientErrors.countLastHour(),
    ]);
    return { from: from.toISOString(), to: to.toISOString(), last_hour: lastHour, groups: rows };
  }
}

/**
 * المدى الافتراضي **٢٤ ساعة** مش ٣٠ يوم زي لوحات التحليلات: السؤال هنا «فيه حاجة مكسورة
 * دلوقتي؟». مدى واسع بيخفي انفجار بدأ الصبح تحت ركام شهر.
 */
function resolveClientErrorRange(query: ClientErrorsQueryDto): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date();
  const hours = query.hours ?? 24;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - hours * 3_600_000);
  return { from, to };
}
