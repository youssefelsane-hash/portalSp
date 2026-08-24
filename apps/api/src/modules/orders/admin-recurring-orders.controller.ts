import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { ListRecurringTemplatesQueryDto } from './dto/list-recurring-templates-query.dto';
import { toAdminRecurringPlanResponseDto } from './dto/recurring-template-response.dto';
import { RecurringOrdersService } from './recurring-orders.service';

// خطط الحجز المتكرر للتشغيل — دي تعريفات التكرار (مين/إيه/إمتى بيتكرر) مش الطلبات نفسها؛
// الطلبات المتولّدة بتتشاف من /admin/orders بفلتر recurring=true وبتتصرف زي أي طلب عادي بالظبط.
// قراءة بس حاليًا — تعطيل/تفعيل خطة معيّنة من الأدمن (نيابة عن العميل) نطاق مستقل لاحق لو احتجناه.
//
// بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-2): كان محمي بـ@Roles(ADMIN)
// بس — أي حساب أدمن كان يقدر يشوف القوالب المتكررة. recurring_orders.view جديدة (migration 0085).
@Controller('admin/recurring-orders')
@Roles(UserType.ADMIN)
@RequirePermission('recurring_orders.view')
export class AdminRecurringOrdersController {
  constructor(private readonly recurringOrdersService: RecurringOrdersService) {}

  @Get()
  async list(@Query() query: ListRecurringTemplatesQueryDto) {
    const { items, meta } = await this.recurringOrdersService.listAllForAdmin(
      query.is_active,
      query.page ?? 1,
      query.per_page ?? 20,
    );
    return { items: items.map(toAdminRecurringPlanResponseDto), meta };
  }
}
