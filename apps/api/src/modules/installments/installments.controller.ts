import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadedFile } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import {
  assertFileSignatureMatches,
} from '../../common/storage/file-signature-validator';
import { UserType } from '../auth/entities/user.entity';
import { InstallmentsService } from './installments.service';

// نفس سياسة مستندات الفنيين بالحرف (technicians.controller.ts) — MIME allowlist + 10MB.
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

// مسارات العميل للتقسيط (migration 0177) — التقديم **طلب مراجعة** مش موافقة ذاتية، والقبول
// إجباري للشروط من الباك-إند. مفيش أي مبلغ بيتبعت من العميل — الحساب كله authoritative هنا.
@Controller()
@Roles(UserType.CUSTOMER)
export class InstallmentsController {
  constructor(private readonly installmentsService: InstallmentsService) {}

  /**
   * أهلية التقسيط **لطلب بعينه** (docs/08 §64.ز) — بلاغ المالك إن بانر «ادفع بالتقسيط» بيفضل
   * معلّق فوق تفاصيل الطلب وبعدين أي خطة تختارها بترفض. المسار ده بيرجّع الخطط اللي بتنفع على
   * الطلب ده **فعلاً** (مبلغه، حالته، تقديماته السابقة)، وسبب واضح لما مفيش.
   */
  @Get('orders/:orderId/installment-options')
  async listOptionsForOrder(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const result = await this.installmentsService.listOptionsForOrder(user.sub, orderId);
    const plans = await Promise.all(
      result.plans.map(async (plan) => {
        const { requirements } = await this.installmentsService.getPlanWithRequirements(plan.id as string);
        return {
          ...plan,
          document_requirements: requirements
            .filter((r) => r.isRequired)
            .map((r) => ({ doc_type: r.docType, label_ar: r.labelAr })),
        };
      }),
    );
    return { ...result, plans };
  }

  /** الخطط المتاحة لخدمة معينة + متطلبات مستنداتها — للعرض قبل الحجز/الدفع. */
  @Get('installment-plans')
  async listPlansForService(@Query('service_id', ParseUUIDPipe) serviceId: string) {
    // الـservice بترجع snake_case جاهز من raw query + متطلبات المستندات لكل خطة
    const plans = await this.installmentsService.listPlansForService(serviceId) as Record<string, unknown>[];
    return Promise.all(
      plans.map(async (plan) => {
        const { requirements } = await this.installmentsService.getPlanWithRequirements(plan.id as string);
        return {
          ...plan,
          document_requirements: requirements
            .filter((r) => r.isRequired)
            .map((r) => ({ doc_type: r.docType, label_ar: r.labelAr })),
        };
      }),
    );
  }

  @Post('orders/:orderId/installment-application')
  @HttpCode(HttpStatus.CREATED)
  async submitApplication(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: { plan_id: string; payment_method_id?: string; accepted_policy_version_ids?: string[] },
  ) {
    if (!dto.plan_id) throw new BadRequestException('لازم تختار خطة تقسيط');
    // مفيش أي مبلغ من العميل هنا عمدًا — breakdown هيُحسب authoritative داخل السيرفس.
    return this.installmentsService.submitApplication({
      userId: user.sub,
      orderId,
      planId: dto.plan_id,
      paymentMethodId: dto.payment_method_id,
      acceptedPolicyVersionIds: dto.accepted_policy_version_ids ?? [],
    });
  }

  /** رفع مستند KYC على طلب التقديم — نفس حماية مستندات الفنيين (MIME+magic bytes). */
  @Post('installment-applications/:applicationId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async uploadDocument(
    @CurrentUser() user: JwtPayload,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body('doc_type') docType: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('لازم ترفع ملف');
    if (!docType?.trim()) throw new BadRequestException('لازم تحدد نوع المستند');
    assertFileSignatureMatches(file.buffer, file.mimetype, ALLOWED_DOCUMENT_MIME_TYPES);
    const documentId = await this.installmentsService.uploadDocument(user.sub, applicationId, docType.trim(), file);
    return { id: documentId };
  }

  @Delete('installment-applications/:applicationId')
  @HttpCode(HttpStatus.OK)
  async cancelApplication(@CurrentUser() user: JwtPayload, @Param('applicationId', ParseUUIDPipe) applicationId: string) {
    await this.installmentsService.cancelApplication(user.sub, applicationId);
    return null;
  }

  /** لوحة العميل: كل خططه + الجدولة + ملخص مدفوع/متبقي/القسط الجاي/متأخرات. */
  @Get('me/installments')
  async myInstallments(@CurrentUser() user: JwtPayload) {
    return this.installmentsService.customerDashboard(user.sub);
  }
}
