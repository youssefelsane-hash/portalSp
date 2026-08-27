import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddressesService } from '../customers/addresses.service';
import { toAddressResponseDto } from '../customers/dto/address-response.dto';
import { AdminCustomer360Service } from './admin-customer-360.service';
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
    private readonly customer360Service: AdminCustomer360Service,
  ) {}

  @Get()
  list(@Query() query: ListCustomersQueryDto) {
    return this.customersService.list(query);
  }

  @Get(':userId')
  getDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.customersService.getDetail(userId);
  }

  // بروفايل 360° (docs/08 §35.15) — نظرة تشغيلية إضافية (عناوين/طلبات حالية/شكاوى بالاتجاهين/
  // تقييم بياخده) فوق البيانات الأساسية اللي getDetail بيرجّعها بالفعل. نفس مستوى الثقة بالظبط
  // زي بروفايل الفني 360° (admin-technicians.controller.ts's getProfile360) — RolesGuard كفاية،
  // مفيش تعديل هنا. نفس أسلوب الماب اليدوي camelCase→snake_case بالظبط.
  @Get(':userId/360')
  async get360(@Param('userId', ParseUUIDPipe) userId: string) {
    const p = await this.customer360Service.getProfile(userId);
    return {
      addresses: p.addresses,
      current_and_upcoming_orders: p.currentAndUpcomingOrders.map((o) => ({
        order_id: o.orderId,
        order_number: o.orderNumber,
        order_status: o.orderStatus,
        scheduled_at: o.scheduledAt ? o.scheduledAt.toISOString() : null,
        service_name_ar: o.serviceNameAr,
      })),
      complaints_filed: {
        open_count: p.complaintsFiled.openCount,
        total_count: p.complaintsFiled.totalCount,
        recent: p.complaintsFiled.recent.map((c) => ({
          id: c.id,
          complaint_number: c.complaintNumber,
          severity: c.severity,
          status: c.status,
          created_at: c.createdAt.toISOString(),
        })),
      },
      complaints_against: {
        open_count: p.complaintsAgainst.openCount,
        total_count: p.complaintsAgainst.totalCount,
        recent: p.complaintsAgainst.recent.map((c) => ({
          id: c.id,
          complaint_number: c.complaintNumber,
          severity: c.severity,
          status: c.status,
          created_at: c.createdAt.toISOString(),
        })),
      },
      ratings_received: {
        average_rating: p.ratingsReceived.averageRating,
        total_count: p.ratingsReceived.totalCount,
        // للأدمن بس (docs/08 §68) — مفيش أي endpoint تاني بيرجّع تقييمات الفنيين للعميل.
        recent: p.ratingsReceived.recent.map((r) => ({
          rating_id: r.ratingId,
          order_id: r.orderId,
          order_number: r.orderNumber,
          overall_rating: r.overallRating,
          comment: r.comment,
          created_at: r.createdAt.toISOString(),
        })),
      },
    };
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
