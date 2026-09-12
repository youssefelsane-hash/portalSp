import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { RatingsService } from './ratings.service';

@Controller('ratings')
@Roles(UserType.CUSTOMER)
export class CustomerPendingRatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Get('pending')
  async pending(@CurrentUser() user: JwtPayload) {
    const rows = await this.ratingsService.listPendingForCustomer(user.sub);
    return rows.map((row) => ({
      order_id: row.orderId,
      order_number: row.orderNumber,
      service_name_ar: row.serviceNameAr,
      technician_name: row.technicianName,
      completed_at: row.completedAt.toISOString(),
    }));
  }
}
