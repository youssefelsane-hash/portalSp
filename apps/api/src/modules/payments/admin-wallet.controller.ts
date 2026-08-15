import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { PaymentsService } from './payments.service';
import { WalletsService } from './wallets.service';
import { toWalletResponseDto, toWalletTransactionResponseDto } from './dto/payments-response.dto';

// بَقّة أمنية اتصلحت (docs/08 §19 بند 8): كانت قراءة بس بلا @RequirePermission (RolesGuard بس،
// أي أدمن يقدر يشوف) — قرار سابق موثّق هنا نفسه ("الأدمن عنده access يشوف المحفظة عشان يشوف هل
// في مشكلة أو لأ")، بس تدقيق لاحق من المالك طلب صراحة إن المحافظ/البيانات المالية الحساسة تبقى
// default-deny زي refunds.issue/payouts.approve بالظبط — ده تصحيح واعي لقرار سابق أوسع من اللازم،
// مش نسيان. wallets.view جديدة (migration 0099)، ممنوحة لـfinance (super_admin بياخدها bypass).
@Controller('admin/wallets')
@Roles(UserType.ADMIN)
@RequirePermission('wallets.view')
export class AdminWalletController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get(':userId')
  async getWallet(@Param('userId', ParseUUIDPipe) userId: string) {
    const [wallet, transactions] = await Promise.all([
      this.walletsService.findByUserIdOrThrow(userId),
      this.walletsService.listTransactionsForUser(userId),
    ]);
    return {
      wallet: toWalletResponseDto(wallet),
      transactions: transactions.map(toWalletTransactionResponseDto),
    };
  }

  // تصحيح محفظة يدوي (docs/08 §20 بند 5) — صلاحية أضيق من القراءة (wallets.adjust بدل
  // wallets.view، migration 0104) + MFA/step-up إجباري (MFA_REQUIRED_PERMISSIONS) لأنه تحويل
  // فلوس حقيقي بقرار أدمن مباشر، نفس مستوى حساسية refunds.issue/payouts.approve بالظبط.
  //
  // بَقّة أمنية حقيقية اتلقطت واتصلحت (تدقيق جاهزية الإطلاق النهائي، 2026-08-14): التعليق فوق
  // كان بيدّعي "MFA/step-up إجباري" بس `@RequireStepUp()` الفعلية متضافتش خالص — `StepUpGuard`
  // (مسجّل global) بيبقى no-op تمامًا من غيرها، يعني جلسة مسروقة/مخترقة كانت تقدر تحوّل فلوس مباشرة
  // من غير أي تأكيد Passkey حديث، رغم إن الحساب نفسه لازم MFA وقت الدخول. نفس الفئة بالظبط اتلقطت
  // في `orders.adjust_price`/`payments.confirm_manual`/`settings.manage` — الأربعة اتصلحوا مع بعض.
  @Patch(':userId/adjust')
  @RequirePermission('wallets.adjust')
  @RequireStepUp()
  async adjustWallet(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdjustWalletDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.paymentsService.adminAdjustWallet(admin.sub, userId, dto.amount_cents, dto.direction, dto.reason_ar, audit);
  }
}
