import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { RecordDebtSettlementDto } from './dto/record-debt-settlement.dto';
import { TechnicianDebtService } from './technician-debt.service';

/**
 * مديونية الفني للمنصة (ADR-0041، docs/08 §63.أ2).
 *
 * **ليه الكونترولر ده في موديول الدفعات مش الفنيين** رغم إن مساره `/admin/technicians/...`:
 * `TechnicianDebtService` محتاج `WalletsService` (دفعات) و`TechniciansService` (فنيين) مع بعض،
 * و`PaymentsModule` بيستورد `TechniciansModule` أصلاً. حطّ الكونترولر في `TechniciansModule` كان
 * بيتطلّب استيراد عكسي = دورة `forwardRef` جديدة في قلب النظام المالي بلا أي داعي. مسار الـURL
 * مش لازم يطابق حدود الموديول — الحدود بتتبع التبعيات.
 *
 * (اتأكّد عمليًا: أول محاولة حطّت المسارات في `AdminTechniciansController` والتطبيق **مقامش**
 * أصلاً بخطأ DI — `npx tsc` و`nest build` عدّوا نضيف لأن ولا واحد فيهم بيبني حاوية DI حقيقية.)
 */
@Controller('admin/technicians')
@Roles(UserType.ADMIN)
export class AdminTechnicianDebtController {
  constructor(private readonly technicianDebtService: TechnicianDebtService) {}

  /** قايمة الفنيين المديونين — شاشة متابعة واحدة بدل ما الأدمن يدوّر فني فني. */
  @Get('debt/outstanding')
  @RequirePermission('wallets.view')
  async listOutstanding() {
    return { items: await this.technicianDebtService.listTechniciansInDebt() };
  }

  /** مديونية فني واحد: المبلغ، عمره، حالته، وسجل السدادات. */
  @Get(':id/debt')
  @RequirePermission('wallets.view')
  async getDebt(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicianDebtService.getDebtView(id);
  }

  /**
   * «الراجل ده دفع» — تسجيل سداد حصل برّه التطبيق.
   *
   * `wallets.adjust` عمدًا: نفس صلاحية التصحيح اليدوي. التسجيل بيحرّك فلوس حقيقية، فنفس
   * مستوى الحماية **بالظبط** — وده كان الكلام بس (docs/08 §188): التعليق هنا كان بيقول «نفس
   * الحماية» والـ`@RequireStepUp()` مش موجودة، و`StepUpGuard` بيبقى no-op من غيرها. يعني
   * جلسة مسروقة كانت تقدر تسجّل سداد وهمي يصفّر دين فني من غير Passkey حديث، بينما
   * `adjustWallet` جنبها محمية. نفس فئة البَقّة اللي اتصلحت هناك في 2026-08-14 بالحرف.
   * ودلوقتي كمان `Idempotency-Key` إجباري بنفس الشكل.
   */
  @Post(':id/debt/settlements')
  @RequirePermission('wallets.adjust')
  @RequireStepUp()
  async recordSettlement(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordDebtSettlementDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @AuditContext() audit: AuditMeta,
  ) {
    const operationKey = idempotencyKey?.trim();
    if (!operationKey || operationKey.length > 120) {
      throw new BadRequestException('Idempotency-Key header مطلوب وبحد أقصى 120 حرف');
    }
    return this.technicianDebtService.recordSettlement(
      admin.sub,
      id,
      {
        amountCents: dto.amount_cents,
        method: dto.method,
        externalReference: dto.external_reference,
        note: dto.note,
      },
      operationKey,
      audit,
    );
  }
}
