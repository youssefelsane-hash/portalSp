import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { ListRecurringTemplatesQueryDto } from './dto/list-recurring-templates-query.dto';
import { toAdminRecurringTemplateResponseDto } from './dto/recurring-template-response.dto';
import { RecurringOrdersService } from './recurring-orders.service';

// وضوح الطلبات المتكررة للتشغيل (docs/08 §32) — كانت فجوة موثّقة صراحة: مفيش أي مسار للأدمن
// يشوف القوالب المتكررة خالص رغم إنها بتولّد طلبات حقيقية كل موعد (recurring-orders.service.ts).
// قراءة بس حاليًا — تعطيل/تفعيل قالب معيّن من الأدمن (نيابة عن العميل) نطاق مستقل لاحق لو احتجناه.
@Controller('admin/recurring-orders')
@Roles(UserType.ADMIN)
export class AdminRecurringOrdersController {
  constructor(private readonly recurringOrdersService: RecurringOrdersService) {}

  @Get()
  async list(@Query() query: ListRecurringTemplatesQueryDto) {
    const { items, meta } = await this.recurringOrdersService.listAllForAdmin(
      query.is_active,
      query.page ?? 1,
      query.per_page ?? 20,
    );
    return { items: items.map(toAdminRecurringTemplateResponseDto), meta };
  }
}
