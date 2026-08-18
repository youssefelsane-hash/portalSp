import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../exceptions/api.exception';
import { UserType } from '../../modules/auth/entities/user.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

// Script 2 Part N — مصفوفة الأمان الكاملة. RolesGuard وJwtAuthGuard هما الحارسان الأساسيان
// اللي بيغطّوا "unauthenticated access" و"wrong role" في كل الـcontrollers، بس مفيش أي منهم كان
// عنده اختبار مباشر (كل الأكواد المشابهة اللي اتعمل تحتها اختبارات كانت بتنادي الـservices
// مباشرة، متخطّية طبقة الـguards نفسها). الاختبارات هنا بتغطي منطق الحراسة نفسه معزول — مفيش
// حاجة تحتاج Postgres/Redis حقيقيين، الاتنين pure logic.
function makeContext(overrides: { userType?: UserType } = {}): ExecutionContext {
  const request = { user: overrides.userType ? { userType: overrides.userType } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard — "wrong role" في مصفوفة الأمان (Script 2 Part N)', () => {
  function guardWithRequiredRoles(requiredRoles: UserType[] | undefined): RolesGuard {
    const reflector = { getAllAndOverride: () => requiredRoles } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('بيسمح بالمرور لو الـendpoint مفيهوش @Roles خالص (مفتوح لأي مستخدم مسجّل دخول)', () => {
    const guard = guardWithRequiredRoles(undefined);
    expect(guard.canActivate(makeContext({ userType: UserType.CUSTOMER }))).toBe(true);
  });

  it('بيسمح للمستخدم لو نوعه مطابق لأحد الأدوار المطلوبة', () => {
    const guard = guardWithRequiredRoles([UserType.TECHNICIAN, UserType.ADMIN]);
    expect(guard.canActivate(makeContext({ userType: UserType.TECHNICIAN }))).toBe(true);
  });

  it('بيرفض بوضوح (403) لو نوع المستخدم مش من الأدوار المطلوبة — "دور غلط"', () => {
    const guard = guardWithRequiredRoles([UserType.ADMIN]);
    expect(() => guard.canActivate(makeContext({ userType: UserType.CUSTOMER }))).toThrow(ApiException);
    try {
      guard.canActivate(makeContext({ userType: UserType.CUSTOMER }));
      fail('لازم يرمي');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(403);
    }
  });

  it('بيرفض عميل حاول يوصل لـendpoint فني بس (السيناريو الأشهر — تخطي التطبيق واستدعاء API مباشر)', () => {
    const guard = guardWithRequiredRoles([UserType.TECHNICIAN]);
    expect(() => guard.canActivate(makeContext({ userType: UserType.CUSTOMER }))).toThrow(ApiException);
  });
});

describe('JwtAuthGuard.handleRequest — "unauthenticated access" في مصفوفة الأمان (Script 2 Part N)', () => {
  function guard(): JwtAuthGuard {
    return new JwtAuthGuard({} as Reflector);
  }

  it('بيرفض بوضوح (401) لو مفيش توكن خالص (user=null، مفيش error)', () => {
    expect(() => guard().handleRequest(null, null, undefined)).toThrow(ApiException);
    try {
      guard().handleRequest(null, null, undefined);
      fail('لازم يرمي');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(401);
    }
  });

  it('بيرفض برسالة مختلفة واضحة لو التوكن منتهي الصلاحية تحديدًا (TokenExpiredError)', () => {
    try {
      guard().handleRequest(null, null, { name: 'TokenExpiredError' });
      fail('لازم يرمي');
    } catch (err) {
      expect((err as ApiException).code).toBe('AUTH_002');
      expect((err as ApiException).getStatus()).toBe(401);
    }
  });

  it('بيرفض لو التوكن غير صالح تمامًا (توقيع غلط/malformed) — كود مختلف عن الانتهاء', () => {
    try {
      guard().handleRequest(new Error('jwt malformed'), null, { name: 'JsonWebTokenError' });
      fail('لازم يرمي');
    } catch (err) {
      expect((err as ApiException).code).toBe('AUTH_001');
    }
  });

  it('بيرجّع اليوزر عادي لو التوكن صالح (مفيش error، مفيش user فاضي)', () => {
    const user = { sub: 'user-1', userType: UserType.CUSTOMER };
    expect(guard().handleRequest(null, user, undefined)).toBe(user);
  });
});
