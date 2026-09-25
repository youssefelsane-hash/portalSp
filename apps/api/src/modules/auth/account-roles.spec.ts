// اختبار حي ضد Postgres حقيقي لأدوار الحساب (ADR-0110). **مفيش mocks** — القيود اللي بيتقاس
// عليها هنا نصها في القاعدة نفسها (تريجرز migration 0363)، وmock كان هيخفي بالظبط الطبقة
// المهمة.
import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { AccountRolesService, consumerRoleOf, isEmployeeUserType } from './account-roles.service';
import { User, UserType } from './entities/user.entity';
import { AccountRole, UserRoleGrant } from './entities/user-role-grant.entity';

describe('أدوار الحساب — العميل والصنايعي بنفس الرقم، والموظفين لأ (ADR-0110)', () => {
  let dataSource: DataSource;
  let service: AccountRolesService;

  const runId = Date.now().toString(36);
  const made: string[] = [];

  const mkUser = async (label: string, userType: UserType): Promise<User> => {
    const [row] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, referral_code)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [`+2015${runId}${label}`.slice(0, 15), `اختبار أدوار ${label}`, userType, `R${runId}${label}`.slice(0, 12)],
    );
    made.push(row.id);
    return dataSource.getRepository(User).findOneByOrFail({ id: row.id });
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, UserRoleGrant],
    });
    await dataSource.initialize();
    service = new AccountRolesService(dataSource.getRepository(UserRoleGrant), dataSource);
  });

  afterAll(async () => {
    if (made.length) {
      await dataSource.query('DELETE FROM user_role_grants WHERE user_id = ANY($1)', [made]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [made]);
    }
    await dataSource.destroy();
  });

  // ── الطلب الأصلي للمالك، حرفيًا ────────────────────────────────────────

  it('صنايعي بيفتح تطبيق العميل بنفس رقمه: الدور بيتمنح فورًا والجلسة بتبقى بدور العميل', async () => {
    const tech = await mkUser('t1', UserType.TECHNICIAN);
    await service.grantRole(tech, AccountRole.TECHNICIAN, { reason: 'registration' });

    const resolved = await service.resolveActiveRole(tech, AccountRole.CUSTOMER);

    // **الدور النشط هو اللي التطبيق فاتح بيه** — ده اللي بيخلي `RolesGuard` يسمح بـ`/orders`.
    expect(resolved.activeRole).toBe(AccountRole.CUSTOMER);
    expect([...resolved.grantedRoles].sort()).toEqual(['customer', 'technician']);
    // ومنحته الأصلية مااتلمستش — رجع لتطبيق الفني يلاقي حسابه زي ما هو.
    expect(await service.hasRole(tech.id, AccountRole.TECHNICIAN)).toBe(true);
  });

  it('عميل بيفتح تطبيق الفني: **مش** بيتمنح تلقائيًا — AUTH_008 بسبب role_not_granted', async () => {
    const customer = await mkUser('c1', UserType.CUSTOMER);
    await service.grantRole(customer, AccountRole.CUSTOMER, { reason: 'registration' });

    // الفرق عن الحالة اللي فوق مقصود: دور الفني بيتحقّق منه (KYC) فمايتمنحش بمجرد فتح التطبيق.
    await expect(service.resolveActiveRole(customer, AccountRole.TECHNICIAN)).rejects.toMatchObject({
      code: 'AUTH_008',
      reason: 'role_not_granted',
    });
    expect(await service.hasRole(customer.id, AccountRole.TECHNICIAN)).toBe(false);
  });

  it('نفس العميل بعد ما يطلب الدور صراحةً بيدخل تطبيق الفني عادي', async () => {
    const customer = await mkUser('c2', UserType.CUSTOMER);
    await service.grantRole(customer, AccountRole.CUSTOMER, { reason: 'registration' });
    await service.grantRole(customer, AccountRole.TECHNICIAN, { reason: 'self_service' });

    const resolved = await service.resolveActiveRole(customer, AccountRole.TECHNICIAN);
    expect(resolved.activeRole).toBe(AccountRole.TECHNICIAN);
    // `users.user_type` مااتغيّرش — هو نوع التوظيف، مش الدور النشط.
    expect(customer.userType).toBe(UserType.CUSTOMER);
  });

  // ── منع الموظفين — التلات طبقات ────────────────────────────────────────

  it('الأدمن بيترفض من تطبيق العميل ومن تطبيق الفني (طبقة الدخول)', async () => {
    const admin = await mkUser('a1', UserType.ADMIN);
    for (const role of [AccountRole.CUSTOMER, AccountRole.TECHNICIAN]) {
      await expect(service.resolveActiveRole(admin, role)).rejects.toBeInstanceOf(ApiException);
    }
    // لوحة التحكم (مفيش دور مطلوب) بتفضل شغّالة زي ما هي بالظبط.
    const dashboard = await service.resolveActiveRole(admin, undefined);
    expect(dashboard.activeRole).toBe('admin');
  });

  it('منح دور لأدمن بيترفض من الخدمة (الطبقة التانية)', async () => {
    const admin = await mkUser('a2', UserType.ADMIN);
    await expect(service.grantRole(admin, AccountRole.CUSTOMER, { reason: 'admin' })).rejects.toBeInstanceOf(
      ApiException,
    );
  });

  it('منح دور لأدمن بيترفض من القاعدة نفسها لو حد لفّ الخدمة (الطبقة اللي مايتخطاهاش كود)', async () => {
    const admin = await mkUser('a3', UserType.PARTNER);
    // INSERT خام — بيتخطّى الخدمة بالكامل، بالظبط زي refactor غلط أو سكربت صيانة.
    await expect(
      dataSource.query(`INSERT INTO user_role_grants (user_id, role) VALUES ($1, 'technician')`, [admin.id]),
    ).rejects.toThrow(/حساب موظف/);
  });

  it('ترقية مستخدم عنده أدوار لحساب موظف بتترفض من القاعدة (الاتجاه التاني)', async () => {
    const customer = await mkUser('c3', UserType.CUSTOMER);
    await service.grantRole(customer, AccountRole.CUSTOMER, { reason: 'registration' });
    // من غير التريجر ده، الترقية كانت بتسيب منحة شغّالة على حساب أدمن — وهي الثغرة بعينها.
    await expect(
      dataSource.query(`UPDATE users SET user_type = 'admin' WHERE id = $1`, [customer.id]),
    ).rejects.toThrow(/أدوار استهلاكية/);
  });

  // ── تفاصيل السلوك ──────────────────────────────────────────────────────

  it('سحب الدور بيسيب أثر تدقيق، وإعادة المنح بعده بتشتغل', async () => {
    const tech = await mkUser('t2', UserType.TECHNICIAN);
    await service.grantRole(tech, AccountRole.CUSTOMER, { reason: 'self_service' });
    await service.revokeRole(tech.id, AccountRole.CUSTOMER);
    expect(await service.hasRole(tech.id, AccountRole.CUSTOMER)).toBe(false);

    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*) FROM user_role_grants WHERE user_id = $1 AND deleted_at IS NOT NULL',
      [tech.id],
    );
    expect(Number(count)).toBe(1); // الصف لسه موجود — التاريخ مااتمسحش

    // الفهرس الفريد **جزئي** على `deleted_at IS NULL`، فإعادة المنح مابتصطدمش بالصف القديم.
    await service.grantRole(tech, AccountRole.CUSTOMER, { reason: 'self_service' });
    expect(await service.hasRole(tech.id, AccountRole.CUSTOMER)).toBe(true);
  });

  it('المنح idempotent — نداء مرتين مابيعملش صفين', async () => {
    const customer = await mkUser('c4', UserType.CUSTOMER);
    await service.grantRole(customer, AccountRole.CUSTOMER, { reason: 'registration' });
    await service.grantRole(customer, AccountRole.CUSTOMER, { reason: 'registration' });
    expect(await service.listRoles(customer.id)).toEqual([AccountRole.CUSTOMER]);
  });

  it('تطبيق قديم مش بيبعت دور بياخد دور `user_type` — توافق خلفي كامل', async () => {
    const tech = await mkUser('t3', UserType.TECHNICIAN);
    await service.grantRole(tech, AccountRole.TECHNICIAN, { reason: 'registration' });
    const resolved = await service.resolveActiveRole(tech, undefined);
    expect(resolved.activeRole).toBe(AccountRole.TECHNICIAN);
  });

  it('حساب قديم بلا منحة خالص بياخد منحة دوره الأصلي بدل ما يتقفل بره', async () => {
    // السيناريو: حساب اتعمل بين تطبيق الـmigration وإعادة تشغيل الخدمة. **مايترفضش** — إحنا
    // مش عايزين إن نشر ADR-0110 يقفل حد بره حسابه.
    const tech = await mkUser('t4', UserType.TECHNICIAN);
    expect(await service.listRoles(tech.id)).toEqual([]);
    const resolved = await service.resolveActiveRole(tech, AccountRole.TECHNICIAN);
    expect(resolved.activeRole).toBe(AccountRole.TECHNICIAN);
    expect(await service.hasRole(tech.id, AccountRole.TECHNICIAN)).toBe(true);
  });

  it('دوال التصنيف: الموظف مالوش دور استهلاكي مقابل', () => {
    expect(isEmployeeUserType(UserType.ADMIN)).toBe(true);
    expect(isEmployeeUserType(UserType.PARTNER)).toBe(true);
    expect(isEmployeeUserType(UserType.CUSTOMER)).toBe(false);
    expect(consumerRoleOf(UserType.ADMIN)).toBeNull();
    expect(consumerRoleOf(UserType.TECHNICIAN)).toBe(AccountRole.TECHNICIAN);
  });
});
