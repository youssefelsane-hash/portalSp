import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AddressesService } from '../customers/addresses.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toOrderResponseDto } from '../orders/dto/order-response.dto';
import { MatchingService } from './matching.service';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';

@Controller('technician/orders')
@Roles(UserType.TECHNICIAN)
export class TechnicianOrdersController {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly addressesService: AddressesService,
  ) {}

  @Get('available')
  listAvailable(@CurrentUser() user: JwtPayload) {
    return this.matchingService.listAvailableForTechnician(user.sub);
  }

  @Post(':id/accept')
  async accept(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.matchingService.accept(user.sub, id);
    // من غير فحص ملكية عمداً — accept() فوق أصلاً بيضمن إن الطلب ده بقى بتاع الفني الحالي،
    // نفس المنطق المستخدم في technician-order-execution.controller.ts. بتوصّل address من هنا
    // عشان زرار "افتح الملاحة" يظهر فوراً بعد القبول، مش بعد أول فعل تنفيذي بس.
    const address = await this.addressesService.findByIdOrThrow(order.addressId);
    return toOrderResponseDto(order, address);
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
    const address = await this.addressesService.findByIdOrThrow(order.addressId);
    return toOrderResponseDto(order, address);
  }

  @Post('work-opportunities/:id/decline')
  async declineWorkOpportunity(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.matchingService.declineWorkOpportunity(user.sub, id);
    return null;
  }
}
