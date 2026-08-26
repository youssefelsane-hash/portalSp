import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toOrderResponseDto, toTechnicianOrderResponseDto } from '../orders/dto/order-response.dto';
import { Order } from '../orders/entities/order.entity';
import { TECHNICIAN_CONTACT_VISIBLE_STATUSES } from '../orders/order-state-machine';
import { PaymentsService } from '../payments/payments.service';
import { CatalogService } from '../catalog/catalog.service';
import { MatchingService } from './matching.service';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';

@Controller('technician/orders')
@Roles(UserType.TECHNICIAN)
export class TechnicianOrdersController {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly addressesService: AddressesService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly paymentsService: PaymentsService,
    private readonly catalogService: CatalogService,
  ) {}

  /**
   * قبول الطلب لازم يرجّع نفس عقد تفاصيل الفني، مش OrderResponseDto العام. العقد العام لا يحتوي
   * `my_earning_cents`، وكان تطبيق الفني يعوّض الحقل الغائب بصفر حتى أول إعادة تحميل للتفاصيل.
   */
  private async toTechnicianDto(order: Order) {
    const contactVisible = TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(order.orderStatus);
    const [address, money, customerContact, serviceNameAr] = await Promise.all([
      this.addressesService.findByIdOrThrow(order.addressId),
      this.paymentsService.getTechnicianMoneyView(order),
      contactVisible ? this.customerProfilesService.findContactInfoOrThrow(order.customerId) : Promise.resolve(null),
      this.catalogService.findServiceOrThrow(order.serviceId).then((service) => service.nameAr),
    ]);
    return toTechnicianOrderResponseDto(
      toOrderResponseDto(order, address, null, { customerContact, serviceNameAr }),
      money,
    );
  }

  @Get('available')
  listAvailable(@CurrentUser() user: JwtPayload) {
    return this.matchingService.listAvailableForTechnician(user.sub);
  }

  @Post(':id/accept')
  async accept(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.matchingService.accept(user.sub, id);
    return this.toTechnicianDto(order);
  }

  @Post(':id/reject')
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAssignmentDto,
  ) {
    await this.matchingService.reject(user.sub, id, dto.reason_code);
    return null;
  }

  // طلبات شغل إضافي اختيارية (docs/08 §34.1b، ADR-0020) — منفصلة تمامًا عن /available فوق (بث
  // الطوارئ، order_assignments). الفني عنده شغل متوسط/تقيل في نفس اليوم لسه بيتعرضله فرصة، بس
  // قبول/رفض صريح بدل تأكيد تلقائي صامت.
  @Get('work-opportunities')
  listWorkOpportunities(@CurrentUser() user: JwtPayload) {
    return this.matchingService.listWorkOpportunitiesForUser(user.sub);
  }

  @Post('work-opportunities/:id/accept')
  async acceptWorkOpportunity(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.matchingService.acceptWorkOpportunity(user.sub, id);
    return this.toTechnicianDto(order);
  }

  @Post('work-opportunities/:id/decline')
  async declineWorkOpportunity(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.matchingService.declineWorkOpportunity(user.sub, id);
    return null;
  }
}
