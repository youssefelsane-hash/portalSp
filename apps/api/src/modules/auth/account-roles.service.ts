import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';

import { User, UserType } from './entities/user.entity';
import { AccountRole, UserRoleGrant } from './entities/user-role-grant.entity';

/** أنواع الحسابات اللي **ممنوع** ياخدوا أي دور استهلاكي (ADR-0110 §6). */
const EMPLOYEE_USER_TYPES: readonly UserType[] = [UserType.ADMIN, UserType.PARTNER];

export function isEmployeeUserType(userType: UserType): boolean {
  return EMPLOYEE_USER_TYPES.includes(userType);
}

/** الدور الاستهلاكي المقابل لـ`user_type` — أو null لو الحساب موظف. */
export function consumerRoleOf(userType: UserType): AccountRole | null {
  if (userType === UserType.CUSTOMER) return AccountRole.CUSTOMER;
  if (userType === UserType.TECHNICIAN) return AccountRole.TECHNICIAN;
  return null;
}

export interface ResolvedActiveRole {
  /** الدور اللي الجلسة دي هتشتغل بيه — بيروح في `JwtPayload.userType`. */
  readonly activeRole: AccountRole;
  /** كل الأدوار الممنوحة — بيروح في `JwtPayload.roles` عشان الواجهة تعرف تعرض إيه. */
  readonly grantedRoles: readonly AccountRole[];
}

/**
 * **مالك أدوار الحساب** (ADR-0110).
 *
 * الفكرة كلها: `users.user_type` = نوع التوظيف (موظف ولا مستهلك)، و`user_role_grants` = الأدوار
 * اللي المستهلك يقدر يشتغل بيها فعلاً. الدور **النشط** في الجلسة بيتحدد هنا، والتطبيق بيطلبه
 * بس **مابيقرّرهوش**.
 *
 * `RolesGuard` مالوش أي علم بالملف ده — لسه بيقارن `request.user.userType` بقايمة المسار. ده
 * مقصود: الحارس هو الجزء اللي ٥٦ موضع بيعتمدوا عليه، فالتغيير اللي بيلمسه بيكبر أثره بلا داعي.
 */
@Injectable()
export class AccountRolesService {
  private readonly logger = new Logger(AccountRolesService.name);

  constructor(
    @InjectRepository(UserRoleGrant) private readonly grants: Repository<UserRoleGrant>,
    private readonly dataSource: DataSource,
  ) {}

  private repo(manager?: EntityManager): Repository<UserRoleGrant> {
    return manager ? manager.getRepository(UserRoleGrant) : this.grants;
  }

  async listRoles(userId: string, manager?: EntityManager): Promise<AccountRole[]> {
    const rows = await this.repo(manager).find({ where: { userId, deletedAt: IsNull() } });
    return rows.map((row) => row.role);
  }

  async hasRole(userId: string, role: AccountRole, manager?: EntityManager): Promise<boolean> {
    return (await this.repo(manager).count({ where: { userId, role, deletedAt: IsNull() } })) > 0;
  }

  /**
   * بيمنح دور. **idempotent** — منحة موجودة بترجع من غير كتابة تانية.
   *
   * الفحص هنا طبقة ثانية فوق تريجر القاعدة، وموجود عشان الرسالة تبقى عربي مفهوم بدل استثناء
   * Postgres خام. **مش** هو الحماية — الحماية في القاعدة.
   */
  async grantRole(
    user: User,
    role: AccountRole,
    options: { reason: string; grantedByUserId?: string | null; manager?: EntityManager } = { reason: 'self_service' },
  ): Promise<void> {
    if (isEmployeeUserType(user.userType)) {
      throw new ApiException(
        ErrorCode.AUTH_001,
        'حساب الموظفين مالوش أدوار على تطبيقات العملاء أو الفنيين. استخدم حساب منفصل برقم مختلف.',
        HttpStatus.FORBIDDEN,
      );
    }
    const repo = this.repo(options.manager);
    if (await this.hasRole(user.id, role, options.manager)) return;
    await repo.save(
      repo.create({
        userId: user.id,
        role,
        grantedByUserId: options.grantedByUserId ?? null,
        grantedReason: options.reason,
      }),
    );
    this.logger.log(`منحة دور: ${role} للمستخدم ${user.id} (${options.reason})`);
  }

  /** سحب دور. بيسيب صف التدقيق (soft delete) عشان تاريخ المنحة مايضيعش. */
  async revokeRole(userId: string, role: AccountRole, manager?: EntityManager): Promise<void> {
    await this.repo(manager).softDelete({ userId, role, deletedAt: IsNull() });
    this.logger.log(`سحب دور: ${role} من المستخدم ${userId}`);
  }

  /**
   * **القرار الأمني المركزي**: التطبيق أعلن إنه بيدخل بدور كذا — هل مسموح؟
   *
   * الردود ممكنة تلاتة:
   *   ١) الحساب موظف ⇒ رفض قاطع. حساب الأدمن مالوش مكان في تطبيق عميل أو فني (ADR-0110 §6).
   *   ٢) الدور ممنوح ⇒ الدور النشط هو المطلوب.
   *   ٣) الدور مش ممنوح ⇒ حسب الدور:
   *      - `customer`: **يتمنح فورًا**. كونك عميل مالوش أي تحقّق — أي حد يعمل حساب عميل من
   *        الصفر، فطلب خطوة زيادة من حساب موجود عرقلة بلا مقابل أمني (ADR-0110 §7-أ).
   *      - `technician`: **رفض مُصنَّف** (`AUTH_008`) بـ`can_request_role` عشان التطبيق يعرض
   *        شاشة «سجّل كصنايعي» بدل قشرة فاضية. الدور ده بيتحقّق منه (KYC) فمايتمنحش تلقائيًا.
   *
   * لو التطبيق مابعتش دور خالص (نسخة قديمة منشورة)، الافتراضي هو دور `user_type` — توافق خلفي
   * كامل، صفر تطبيق بيتكسر بالنشر.
   */
  async resolveActiveRole(
    user: User,
    requestedRole: AccountRole | undefined,
    options: { autoProvision?: (role: AccountRole, manager: EntityManager) => Promise<void> } = {},
  ): Promise<ResolvedActiveRole> {
    if (isEmployeeUserType(user.userType)) {
      // الرفض ده بيحصل **بعد** ما الرمز يتأكد، فمابيفشيش إن الرقم ده لأدمن لحد بيخمّن أرقام.
      if (requestedRole) {
        throw new ApiException(
          ErrorCode.AUTH_001,
          'الحساب ده حساب إداري — سجّل دخول من لوحة التحكم، مش من تطبيق العملاء أو الفنيين.',
          HttpStatus.FORBIDDEN,
        );
      }
      // مفيش دور مطلوب = لوحة التحكم. الموظف بياخد `user_type` بتاعه زي ما كان بالظبط.
      return { activeRole: user.userType as unknown as AccountRole, grantedRoles: [] };
    }

    const granted = await this.listRoles(user.id);
    const fallback = consumerRoleOf(user.userType);
    const target = requestedRole ?? fallback;

    if (!target) {
      throw new ApiException(ErrorCode.AUTH_001, 'الحساب ده مالوش دور صالح للدخول', HttpStatus.FORBIDDEN);
    }

    if (granted.includes(target)) {
      return { activeRole: target, grantedRoles: granted };
    }

    // الحسابات اللي اتعملت قبل migration 0363 لازم يكون عندها منحة بدورها الأصلي؛ لو مش
    // موجودة (حساب اتعمل بين تطبيق الـmigration وإعادة تشغيل الخدمة) بنصلّحها هنا بدل ما
    // نقفل على المستخدم.
    if (target === fallback) {
      await this.dataSource.transaction(async (manager) => {
        await this.grantRole(user, target, { reason: 'backfill', manager });
      });
      return { activeRole: target, grantedRoles: [...new Set([...granted, target])] };
    }

    if (target === AccountRole.CUSTOMER) {
      await this.dataSource.transaction(async (manager) => {
        await this.grantRole(user, target, { reason: 'self_service', manager });
        await options.autoProvision?.(target, manager);
      });
      return { activeRole: target, grantedRoles: [...new Set([...granted, target])] };
    }

    throw new ApiException(
      ErrorCode.AUTH_008,
      'حسابك مش مسجّل كصنايعي. سجّل كصنايعي الأول وبعد التوثيق تقدر تشتغل من التطبيق ده.',
      HttpStatus.FORBIDDEN,
      // سبب آلي ثابت (ADR-0101) — التطبيق بيفرّق بيه بين «مرفوض» و«محتاج تسجيل» من غير ما
      // يقرا نص الرسالة العربي.
      'role_not_granted',
    );
  }
}
