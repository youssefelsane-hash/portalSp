import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ClientErrorsService } from './client-errors.service';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

/**
 * **نقطة استقبال أخطاء الواجهة** (ADR-0114) — مسار الكتابة العام الوحيد في الموديول ده، فكل
 * ضابط عليه مقصود ومكتوب.
 *
 * **ليه `@Public()`**: أهم الأخطاء بتحصل **قبل** الدخول — شاشة اللوجن نفسها، صفحة خدمة جاية من
 * جوجل، مستخدم توكنه خلص. مسار محمي بتوكن كان هيسجّل كل حاجة *إلا* اللي إحنا بنبنيه عشانه.
 *
 * الضوابط اللي بتخلّي ده مقبول:
 * 1. سقف ٣٠/دقيقة لكل IP — صفحة مكسورة بتبعت خطأ أو اتنين، مش ٣٠.
 * 2. الـDTO مقفول (`forbidNonWhitelisted` في الـpipe العام) + `@MaxLength` على كل حقل نصي +
 *    `kind`/`app` قايمة مقفولة بـ`@IsIn`.
 * 3. **الرد `202` فاضي دايمًا** — مايقولش إذا اتخزّن ولا اتجاهل. مسار كتابة عام بيرجّع تفاصيل
 *    بيبقى أداة استكشاف.
 * 4. `user_id` بيتقرا من **توكن متحقَّق منه** لو موجود، وأبداً من الجسم.
 * 5. القراءة كلها تحت `admin/ops` بـ`operations.view` — مفيش أي قراءة عامة.
 */
@Controller('telemetry')
export class ClientErrorsController {
  constructor(
    private readonly clientErrors: ClientErrorsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('client-errors')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async report(
    @Body() dto: ReportClientErrorDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    await this.clientErrors.record(dto, {
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      userId: await this.optionalUserId(authorization),
    });
  }

  /**
   * توكن **متحقَّق منه** أو `null`. التحقق مش فك ترميز: توكن موقّع غلط مالوش قيمة، وقبوله كان
   * بيخلّي أي حد ينسب أخطاءه لأي مستخدم فيلوّث كل التجميع.
   */
  private async optionalUserId(authorization: string | undefined): Promise<string | null> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      return payload.sub ?? null;
    } catch {
      // توكن منتهي أو غلط: الحدث بيتخزّن مجهول الهوية — مش بيترفض. الخطأ نفسه هو المعلومة.
      return null;
    }
  }
}
