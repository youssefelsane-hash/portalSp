import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UserType } from '../auth/entities/user.entity';
import { OpsMetricsService } from './ops-metrics.service';

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
  constructor(private readonly metrics: OpsMetricsService) {}

  @Get('health-metrics')
  @RequirePermission('operations.view')
  async healthMetrics() {
    return this.metrics.collect();
  }
}
