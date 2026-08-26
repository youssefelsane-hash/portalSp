import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
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

// إشراف الأدمن على شركات/فرق الفنيين — القراءة read-only عمداً، الإدارة نفسها ذاتية (owner/manager
// بتاعت كل شركة) زي أي أدمن يشوف كل حاجة (RolesGuard كفاية، مفيش @RequirePermission).
//
// الاستثناء الوحيد: علامة التوثيق (ADR-0039). دي **مش** إدارة ذاتية بطبيعتها — لو الشركة تقدر
// تمنح نفسها إشارة ثقة تبقى بلا معنى — فهي الكتابة الوحيدة هنا، ومحمية بصلاحية صريحة.
@Controller('admin/technician-companies')
@Roles(UserType.ADMIN)
export class AdminTechnicianCompaniesController {
  constructor(private readonly companiesService: TechnicianCompaniesService) {}

  @Get()
  async list() {
    const rows = await this.companiesService.listForAdmin();
    return rows.map(({ company, branchCount, staffCount }) => ({
      ...toCompanyResponseDto(company),
      branch_count: branchCount,
      staff_count: staffCount,
    }));
  }

  @Get(':id')
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
  async listOrders(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.companiesService.listOrdersForAdmin(id);
    return rows.map(toCompanyOrderSummaryResponseDto);
  }
}
