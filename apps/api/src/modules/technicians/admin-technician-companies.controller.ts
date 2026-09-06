import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { SetTrustBadgeDto } from './dto/set-trust-badge.dto';
import { SetCompanyPriceMultiplierDto } from './dto/set-company-price-multiplier.dto';
import {
  toBranchResponseDto,
  toCompanyResponseDto,
  toCompanyOrderSummaryResponseDto,
  toStaffMemberResponseDto,
} from './dto/company-response.dto';
import { TechnicianCompaniesService } from './technician-companies.service';
import { ProviderScopeService } from './provider-scope.service';
import {
  AssignProviderCategoryDto,
  AssignProviderServiceDto,
  AssignProviderZoneDto,
} from './dto/assign-provider-scope.dto';
import { toTechnicianCategoryResponseDto } from './dto/technician-category-response.dto';
import { toTechnicianServiceResponseDto } from './dto/technician-service-response.dto';
import { toTechnicianZoneResponseDto } from './dto/technician-zone-response.dto';

// إشراف الأدمن على شركات/فرق الفنيين — القراءة read-only عمداً، الإدارة نفسها ذاتية (owner/manager
// بتاعت كل شركة) زي أي أدمن يشوف كل حاجة (RolesGuard كفاية، مفيش @RequirePermission).
//
// الاستثناء الوحيد: علامة التوثيق (ADR-0039). دي **مش** إدارة ذاتية بطبيعتها — لو الشركة تقدر
// تمنح نفسها إشارة ثقة تبقى بلا معنى — فهي الكتابة الوحيدة هنا، ومحمية بصلاحية صريحة.
@Controller('admin/technician-companies')
@Roles(UserType.ADMIN)
export class AdminTechnicianCompaniesController {
  constructor(
    private readonly companiesService: TechnicianCompaniesService,
    private readonly providerScope: ProviderScopeService,
  ) {}

  /** ADR-0079 — الشركة مالك نطاق زي الفني بالظبط، بنفس الخدمة ونفس الجداول. */
  private owner(id: string) {
    return { kind: 'company' as const, id };
  }

  @Get()
  @RequirePermission('technician_companies.view')
  async list() {
    const rows = await this.companiesService.listForAdmin();
    return rows.map(({ company, branchCount, staffCount }) => ({
      ...toCompanyResponseDto(company),
      branch_count: branchCount,
      staff_count: staffCount,
    }));
  }

  @Get(':id')
  @RequirePermission('technician_companies.view')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.companiesService.getDetail(id);
    return {
      company: toCompanyResponseDto(detail.company),
      branches: detail.branches.map(toBranchResponseDto),
      staff: detail.staff.map(({ profile, user }) => toStaffMemberResponseDto(profile, user.fullName)),
    };
  }

  @Patch(':id/trust-badge')
  @RequirePermission('technicians.approve')
  async setTrustBadge(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTrustBadgeDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const company = await this.companiesService.setTrustBadge(admin.sub, id, dto.granted, dto.note ?? null, audit);
    return toCompanyResponseDto(company);
  }

  /**
   * معامل سعر الشركة (ADR-0042، docs/08 §64.و) — الكتابة التانية الوحيدة هنا، ولنفس السبب:
   * السعر اللي العميل بيدفعه مش إدارة ذاتية. `orders.adjust_price` مش `technicians.approve`
   * عمدًا — ده قرار **تسعير** مش قرار اعتماد، ومحمي بنفس صلاحية أي تغيير سعر تاني في المنصة.
   */
  @Patch(':id/price-multiplier')
  @RequirePermission('orders.adjust_price')
  async setPriceMultiplier(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCompanyPriceMultiplierDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const company = await this.companiesService.setPriceMultiplier(
      admin.sub,
      id,
      dto.price_multiplier,
      dto.note ?? null,
      audit,
    );
    return toCompanyResponseDto(company);
  }

  // مساحة عمل الشركة (ADR-0033) — إشراف read-only، نفس نمط باقي الكونترولر ده.
  @Get(':id/orders')
  @RequirePermission('technician_companies.view')
  async listOrders(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.companiesService.listOrdersForAdmin(id);
    return rows.map(toCompanyOrderSummaryResponseDto);
  }

  // ── نطاق تشغيل الشركة (ADR-0079) ────────────────────────────────────
  //
  // «أنا عايز الشركة يكون عندها نفس اللي عند الفني بالضبط، عشان الأدمين يعرف يخش يديها
  // صلاحيات تشتغل فيهم وتشتغلش في إيه، تشتغل في أنهي مناطق» (طلب مالك، 2026-09-06).
  //
  // نفس الجداول ونفس الخدمة اللي بتخدم نطاق الفني — `ProviderScopeService` — بمالك مختلف بس.
  // الصلاحيات نفس صلاحيات نطاق الفني بالحرف عشان مايبقاش فيه باب خلفي أوسع للشركة.

  @Get(':id/services')
  @RequirePermission('technician_companies.view')
  async listServices(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.providerScope.listServices(this.owner(id));
    return rows.map((row) => toTechnicianServiceResponseDto(row));
  }

  @Post(':id/services')
  @RequirePermission('technicians.approve')
  async assignService(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProviderServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.providerScope.assignService(admin.sub, this.owner(id), dto.service_id, audit);
    return toTechnicianServiceResponseDto(row);
  }

  @Delete(':id/services/:serviceId')
  @RequirePermission('technicians.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeService(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.providerScope.removeService(admin.sub, this.owner(id), serviceId, audit);
  }

  @Get(':id/categories')
  @RequirePermission('technician_companies.view')
  async listCategories(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.providerScope.listCategories(this.owner(id));
    return rows.map((row) => toTechnicianCategoryResponseDto(row));
  }

  @Post(':id/categories')
  @RequirePermission('technicians.approve')
  async assignCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProviderCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.providerScope.assignCategory(admin.sub, this.owner(id), dto.category_id, audit);
    return toTechnicianCategoryResponseDto(row);
  }

  @Delete(':id/categories/:categoryId')
  @RequirePermission('technicians.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.providerScope.removeCategory(admin.sub, this.owner(id), categoryId, audit);
  }

  @Get(':id/zones')
  @RequirePermission('technician_companies.view')
  async listZones(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.providerScope.listZones(this.owner(id));
    return rows.map(toTechnicianZoneResponseDto);
  }

  @Post(':id/zones')
  @RequirePermission('technicians.approve')
  async assignZone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProviderZoneDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.providerScope.assignZone(admin.sub, this.owner(id), dto.service_zone_id, dto.is_primary ?? false, audit);
    return toTechnicianZoneResponseDto(row);
  }

  @Delete(':id/zones/:zoneId')
  @RequirePermission('technicians.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeZone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.providerScope.removeZone(admin.sub, this.owner(id), zoneId, audit);
  }
}
