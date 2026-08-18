import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddressesService } from '../customers/addresses.service';
import { toAddressResponseDto } from '../customers/dto/address-response.dto';
import { AdminCustomersService } from './admin-customers.service';
import { BlockCustomerDto } from './dto/block-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

// إدارة العملاء (عرض بروفايلات/إحصائيات + حظر/فك حظر) — محتاجة customers.manage للحظر،
// القراءة مفتوحة لأي أدمن زي باقي كنترولرز الإدارة (RolesGuard كفاية للـ GET).
@Controller('admin/customers')
@Roles(UserType.ADMIN)
export class AdminCustomersController {
  constructor(
    private readonly customersService: AdminCustomersService,
    private readonly addressesService: AddressesService,
  ) {}

  @Get()
  list(@Query() query: ListCustomersQueryDto) {
    return this.customersService.list(query);
  }

  @Get(':userId')
  getDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.customersService.getDetail(userId);
  }

  // Call Center — عناوين العميل قبل إنشاء طلب نيابة عنه (Script 4 §33-37). نفس
  // AddressesService.findAllForUser() اللي العميل نفسه بيستخدمه (GET /addresses) — صفر منطق
  // كتالوج/عناوين تاني منفصل. قراءة بس، صفر إنشاء/تعديل عنوان نيابة عن العميل (خارج نطاق هنا).
  @Get(':userId/addresses')
  async listAddresses(@Param('userId', ParseUUIDPipe) userId: string) {
    const addresses = await this.addressesService.findAllForUser(userId);
    return addresses.map((address) => toAddressResponseDto(address, false));
  }

  @Post(':userId/block')
  @RequirePermission('customers.manage')
  block(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: BlockCustomerDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.customersService.block(admin.sub, userId, dto, audit);
  }

  @Post(':userId/unblock')
  @RequirePermission('customers.manage')
  unblock(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.customersService.unblock(admin.sub, userId, audit);
  }

  // §24 — كانت فجوة موثّقة صراحة: soft-delete اتبنى للموظفين بس مش للعملاء رغم نفس الحاجة بالظبط.
  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customers.manage')
  delete(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.customersService.delete(admin.sub, userId, audit);
  }
}
