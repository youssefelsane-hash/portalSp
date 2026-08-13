import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { JwtPayload } from '../types/authenticated-request';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
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
    return payload;
  }
}
