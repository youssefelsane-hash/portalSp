import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { createHash } from 'crypto';

type ThrottledRequest = Partial<Request> & { body?: unknown };

/**
 * **مين اللي بيتعدّ في الـrate limit؟** (تدقيق `docs/29` P0-2)
 *
 * `ThrottlerGuard` الافتراضي بيتعقّب بالـIP وبس. ده بيتكسر في مصر بالذات لسببين مستقلين:
 *
 * 1. **الـproxy**: بدون `trust proxy` (اتظبط في `http-bootstrap.ts`) كل الطلبات بتيجي من IP
 *    الـload balancer، فالمنصة كلها بتشترك في دلو واحد.
 * 2. **CGNAT**: حتى مع `trust proxy` مضبوط، شركات المحمول المصرية بتشارك آلاف المشتركين على
 *    IPs معدودة. يعني خمس عملاء طلبوا OTP في دقيقة = باقي العملاء على نفس الـIP **مقفول عليهم
 *    التسجيل** رغم إنهم ما عملوش حاجة.
 *
 * القاعدة هنا: **اتعقّب بأدق هوية متاحة**، والـIP آخر حل مش أول حل.
 *
 * - مسار فيه `phone_number` في الـbody (OTP، تسجيل، استرداد) ⇒ `phone:<hash(الرقم)>`.
 *   ده **أدق أمنيًا** من الـIP كمان: الهدف الحقيقي من تحديد OTP هو منع قصف رقم بعينه برسايل،
 *   والقياس بالرقم بيمنع ده حرفيًا، بينما القياس بالـIP بيقفل على ناس بريئة على نفس الـCGNAT
 *   ويسيب المهاجم اللي بيغيّر IP يعدّي.
 * - غير كده ⇒ الـIP — وهو دلوقتي **العميل الحقيقي** لأن `trust proxy` اتظبط.
 *
 * الرقم بيتخزّن **مهشوش** — مفاتيح الـthrottle بتروح Redis وبتفضل في الذاكرة، وأرقام الموبايل
 * بيانات شخصية مايصحش تتخزّن خام في مكان مش محتاجها.
 *
 * ### ليه مفيش تعقّب بالمستخدم (`user:<sub>`)؟
 *
 * الحارس ده مُسجَّل **قبل** `JwtAuthGuard` في `app.module.ts` عمدًا، فـ`req.user` لسه مش
 * موجود وقت `getTracker()`. الترتيب ده مقصود: لو اتأخر عن المصادقة، أي سيل من طلبات بتوكن
 * باطل هيترفض بـ401 **من غير ما يعدّي على الـthrottle أصلًا** — يعني مسار غير محدود تمامًا،
 * وده يخالف مبدأ «مهما حصل النظام مايقعش».
 *
 * التعقّب بالمستخدم ممكن يتضاف بعدين كطبقة **تانية** (حارس منفصل بعد المصادقة بسقوف أعلى)،
 * مش بتحريك الحارس ده. **ممنوع** فك الـJWT هنا بلا تحقق من التوقيع عشان نقرا `sub` — ده
 * بيسمح لأي حد يزوّر `sub` ويستهلك حصة عميل تاني أو يولّد حصص لا نهائية.
 */
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: ThrottledRequest, _context?: ExecutionContext): Promise<string> {
    const body = req?.body;
    const phone = body && typeof body === 'object' ? (body as Record<string, unknown>).phone_number : undefined;
    if (typeof phone === 'string' && phone.length > 0) {
      return `phone:${createHash('sha256').update(phone).digest('hex').slice(0, 32)}`;
    }

    // الـIP هنا بيبقى العميل الحقيقي لأن `trust proxy` مضبوط في `configureHttpLayer`.
    return `ip:${req?.ip ?? 'unknown'}`;
  }
}
