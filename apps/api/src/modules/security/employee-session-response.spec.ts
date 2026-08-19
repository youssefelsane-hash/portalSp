import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { toEmployeeSessionResponseDto } from './dto/employee-session-response.dto';
import { WorkforceActivityService } from './workforce-activity.service';

/**
 * بَقّة أمنية حقيقية اتلقطت واتصلحت (Script 6 Part 23): `GET /admin/workforce/employees/:userId/
 * sessions` كان بيرجّع كيان `RefreshToken` الخام مباشرة — بما فيه `token_hash` (السر اللي بيثبت
 * هوية الجلسة، حتى لو hashed مش المفروض يوصل أي واجهة خالص)، و`user_id`/`device_id`/`user_agent`/
 * `expires_at` (تفاصيل داخلية زيادة عن `EmployeeSessionDto` المُعرَّف في `@baytak/shared-types`).
 *
 * الاختبار ده بيثبت حيًا (Postgres حقيقي، صف `refresh_tokens` حقيقي بقيم حساسة معروفة) إن
 * `toEmployeeSessionResponseDto()` — ونفس المسار اللي `AdminWorkforceController.listSessions()`
 * بيستخدمه بالحرف — **مستحيل** يسرّب أي قيمة حساسة، مش بس إنه "بيرجّع الحقول الصح". الفحص بيتأكد
 * من مستويين: (1) مفاتيح الكائن الراجع محصورة في القايمة المسموحة بالاسم، (2) القيم الحساسة
 * الفعلية (token_hash/device_id/user_agent الحقيقية اللي اتزرعت) مش موجودة في أي مكان من
 * `JSON.stringify()` للرد — حماية إضافية ضد أي تسريب غير متوقع حتى لو اسم مفتاح جديد اتضاف بالغلط.
 */
describe('toEmployeeSessionResponseDto — منع تسريب tokenHash/بيانات داخلية (Script 6 Part 23 — أمان)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: WorkforceActivityService;
  const runId = Date.now().toString(36);
  const ids = { user: '', session: '' };

  const SENSITIVE_TOKEN_HASH = `super-secret-token-hash-${runId}`;
  const SENSITIVE_DEVICE_ID = `secret-device-id-${runId}`;
  const SENSITIVE_USER_AGENT = `Mozilla/5.0 SecretUserAgentString/${runId}`;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, RefreshToken],
    });
    await dataSource.initialize();

    service = new WorkforceActivityService(
      dataSource,
      dataSource.getRepository(RefreshToken),
      {} as never, // settingsService — مش مستخدم في listSessions()
      {} as never, // auditLog — مش مستخدم في listSessions()
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2098${runId}`.slice(0, 15), `أدمن اختبار تسريب ${runId}`],
    );
    ids.user = user.id;

    const [session] = await q(
      `INSERT INTO refresh_tokens
         (user_id, token_hash, device_id, device_name, device_platform, ip_address, user_agent,
          amr, expires_at)
       VALUES ($1,$2,$3,'iPhone حقيقي','ios','10.0.0.1',$4,'["otp"]', now() + interval '7 days')
       RETURNING id`,
      [ids.user, SENSITIVE_TOKEN_HASH, SENSITIVE_DEVICE_ID, SENSITIVE_USER_AGENT],
    );
    ids.session = session.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ids.user]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('listSessions() ← toEmployeeSessionResponseDto(): مفاتيح الرد محصورة في القايمة المسموحة بس', async () => {
    const sessions = await service.listSessions(ids.user);
    expect(sessions.length).toBeGreaterThan(0);
    const dto = sessions.map(toEmployeeSessionResponseDto).find((s) => s.id === ids.session)!;
    expect(dto).toBeDefined();

    const allowedKeys = new Set([
      'id',
      'deviceName',
      'devicePlatform',
      'ipAddress',
      'lastSeenAt',
      'lastActivityAt',
      'amr',
      'isRevoked',
      'revokedAt',
      'revokedReason',
      'createdAt',
    ]);
    for (const key of Object.keys(dto)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    // بالاسم الصريح: الحقول الحساسة/الداخلية دي لازم تكون مش موجودة خالص، مش بس "مش في القايمة
    // المسموحة" (فحص مزدوج يوضّح القصد لو حد قرا الاختبار بعدين).
    expect(dto).not.toHaveProperty('tokenHash');
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('deviceId');
    expect(dto).not.toHaveProperty('userAgent');
    expect(dto).not.toHaveProperty('expiresAt');
  });

  it('القيم الحساسة الفعلية مش موجودة في أي مكان من الرد المُسلسَل — حماية ضد تسريب غير متوقع', async () => {
    const sessions = await service.listSessions(ids.user);
    const dtos = sessions.map(toEmployeeSessionResponseDto);
    const serialized = JSON.stringify(dtos);

    expect(serialized).not.toContain(SENSITIVE_TOKEN_HASH);
    expect(serialized).not.toContain(SENSITIVE_DEVICE_ID);
    expect(serialized).not.toContain(SENSITIVE_USER_AGENT);
    expect(serialized).not.toContain(ids.user); // userId ماينفعش يتسرّب برضه
  });

  it('الحقول المسموحة برضه بترجع صح (مش بس "مش الحقول الممنوعة") — التوثيق مش بديل عن التحقق', async () => {
    const sessions = await service.listSessions(ids.user);
    const dto = sessions.map(toEmployeeSessionResponseDto).find((s) => s.id === ids.session)!;
    expect(dto.deviceName).toBe('iPhone حقيقي');
    expect(dto.devicePlatform).toBe('ios');
    expect(dto.ipAddress).toBe('10.0.0.1');
    expect(dto.amr).toEqual(['otp']);
    expect(dto.isRevoked).toBe(false);
  });
});
