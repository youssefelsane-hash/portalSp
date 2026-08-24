import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { PaymentPoliciesService } from './payment-policies.service';

// سياسات الدفع/الشروط — الاستهلاك العام: العميل يسأل "إيه المطلوب قبوله في الـcheckout ده؟"
// (نسخة حالية + نصها + إجباري أو لا). الإدارة: CRUD + نشر نسخ (النسخ immutable).
@Controller()
export class PaymentPoliciesController {
  constructor(private readonly paymentPoliciesService: PaymentPoliciesService) {}

  /** أي سياسات تنطبق على checkout الخدمة دي؟ — public، بيرجع النسخة الحالية ونصها. */
  @Public()
  @Get('checkout/payment-policies')
  async applicable(
    @Query('applies_to') appliesTo = 'postpaid_service',
    @Query('service_id') serviceId?: string,
  ) {
    const list = await this.paymentPoliciesService.listApplicableForCheckout({
      appliesTo,
      serviceId: serviceId || undefined,
    });
    return list;
  }

  // ===================== Admin =====================

  @Get('admin/payment-policies')
  @Roles(UserType.ADMIN)
  @RequirePermission('payment_policies.manage')
  async listAll() {
    return this.paymentPoliciesService.listAll();
  }

  @Get('admin/payment-policies/:id/versions')
  @Roles(UserType.ADMIN)
  @RequirePermission('payment_policies.manage')
  async versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentPoliciesService.listVersions(id);
  }

  @Post('admin/payment-policies')
  @Roles(UserType.ADMIN)
  @RequirePermission('payment_policies.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: Record<string, unknown>, @AuditContext() audit: AuditMeta) {
    return this.paymentPoliciesService.createPolicy(admin.sub, dto as never, audit);
  }

  /** تعديل الميتاداتا بس — النص بيتغير بنشر نسخة جديدة (immutable by design). */
  @Patch('admin/payment-policies/:id')
  @Roles(UserType.ADMIN)
  @RequirePermission('payment_policies.manage')
  async updateMeta(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.paymentPoliciesService.updatePolicyMeta(admin.sub, id, dto as never, audit);
  }

  @Post('admin/payment-policies/:id/versions')
  @Roles(UserType.ADMIN)
  @RequirePermission('payment_policies.manage')
  async publishVersion(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { body_ar: string },
    @AuditContext() audit: AuditMeta,
  ) {
    return this.paymentPoliciesService.publishNewVersion(admin.sub, id, dto.body_ar, audit);
  }
}
