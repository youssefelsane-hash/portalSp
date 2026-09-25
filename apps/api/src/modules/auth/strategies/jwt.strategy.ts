import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { IsNull, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserRoleGrant } from '../entities/user-role-grant.entity';
import { consumerRoleOf, isEmployeeUserType } from '../account-roles.service';
import { JwtPayload } from '../types/authenticated-request';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRoleGrant) private readonly grants: Repository<UserRoleGrant>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
    });
  }

  /**
   * بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-6) — كانت موثّقة صراحة
   * كفجوة معمارية في `admin/README.md`: `validate()` كانت بترجّع الـpayload بس من غير أي فحص
   * قاعدة بيانات — يعني حظر مستخدم (عميل/فني/أدمن) عنده access token لسه ساري (أقصى مدة 15 دقيقة)
   * كان يفضل يقدر يستخدمه لحد ما ينتهي، حتى لو الأدوار اتسحبت والـrefresh tokens اتلغت فورًا.
   * `PermissionsGuard` بيتحقق حياً من القاعدة لأي فعل محمي بصلاحية دقيقة، بس أي فعل مفتوح
   * (زي GET عادي لأي مستخدم مسجّل) كان بيفضل شغال بالتوكن القديم.
   *
   * الإصلاح: فحص حي `is_blocked`/`is_active`/`deleted_at` هنا — بيتنفّذ على كل طلب مُصادَق عليه
   * (قراءة واحدة بالمفتاح الأساسي، غير مكلفة)، فحظر/حذف حساب بياخد مفعوله من الطلب الجاي مباشرة
   * بدل ما يستنى انتهاء التوكن. مفيش cache هنا عمداً — الهدف الأساسي "فورية" الحظر، وكاش حتى بمدة
   * قصيرة (30 ثانية مثلاً) كان هيعيد فتح نفس الفجوة بحجم أصغر بلا داعي حقيقي للأداء دلوقتي.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.isBlocked || !user.isActive) {
      throw new UnauthorizedException('الحساب غير متاح');
    }
    await this.assertActiveRoleStillGranted(payload, user);
    return payload;
  }

  /**
   * **سحب الدور بياخد مفعوله من الطلب الجاي** (ADR-0110 §5) — نفس فلسفة فحص الحظر الحي فوق.
   *
   * الدور النشط جوّه توكن موقّع، فلو أدمن سحب دور الصنايعي من حساب، التوكن القديم كان هيفضل
   * شغّال لحد ١٥ دقيقة. الفحص ده بيقفل الشباك ده — وهو بالظبط نفس البَقّة (P0-6) اللي اتصلحت
   * للحظر فوق، فمش منطقي نعيدها بشكل أصغر لأدوار.
   *
   * **بيعمل الفحص للأدوار الاستهلاكية بس**: الموظفين (`admin`/`partner`) مالهمش منح أصلاً
   * (migration 0363)، وتوكنز اتصدرت قبل ADR-0110 مافيهاش `roles` — الاتنين بيعدّوا زي ما كانوا
   * بالظبط، فمفيش جلسة قايمة بتتكسر بالنشر.
   */
  private async assertActiveRoleStillGranted(payload: JwtPayload, user: User): Promise<void> {
    if (isEmployeeUserType(user.userType)) return;
    const activeRole = consumerRoleOf(payload.userType);
    // التوكن مش شايل دور استهلاكي (جلسة قديمة/مسار مش استهلاكي) ⇒ نفس السلوك القديم.
    if (!activeRole || !payload.roles) return;

    const granted = await this.grants.count({
      where: { userId: payload.sub, role: activeRole, deletedAt: IsNull() },
    });
    if (granted === 0) {
      throw new UnauthorizedException('الدور بتاع الجلسة دي مبقى متاح للحساب');
    }
  }
}
