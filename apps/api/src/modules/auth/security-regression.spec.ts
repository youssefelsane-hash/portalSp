import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { WebAuthnService } from './webauthn.service';
import { StepUpService } from './step-up.service';
import { AdminMfaRecoveryCode } from './entities/admin-mfa-recovery-code.entity';
import { StepUpToken } from './entities/step-up-token.entity';
import { User } from './entities/user.entity';
import { WebAuthnChallenge } from './entities/webauthn-challenge.entity';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';

// اختبارات حية ضد Postgres حقيقي — مراجعة أمان (2026-08-14، §23/§25 من توجيه المالك) لأخطر مسارات
// ADR-0011 (استرجاع MFA وStep-Up) تحت تزامن حقيقي، مش افتراض من قراءة الكود بس.
describe('Auth security regression — replay/concurrency (§23/§25)', () => {
  let dataSource: DataSource;
  let webAuthnService: WebAuthnService;
  let stepUpService: StepUpService;

  const runId = Date.now().toString(36);
  const userId1 = '00000000-0000-0000-0000-00000000000' + '1';
  let realUserId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, WebAuthnCredential, WebAuthnChallenge, AdminMfaRecoveryCode, StepUpToken],
    });
    await dataSource.initialize();

    webAuthnService = new WebAuthnService(
      dataSource.getRepository(User),
      dataSource.getRepository(WebAuthnCredential),
      dataSource.getRepository(WebAuthnChallenge),
      dataSource.getRepository(AdminMfaRecoveryCode),
      {} as never,
    );
    stepUpService = new StepUpService(dataSource.getRepository(StepUpToken));

    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2015${runId}`.slice(0, 15), `موظف اختبار أمان ${runId}`],
    );
    realUserId = user.id;
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM admin_mfa_recovery_codes WHERE user_id = $1`, [realUserId]);
    await dataSource.query(`DELETE FROM step_up_tokens WHERE user_id = $1`, [realUserId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [realUserId]);
    await dataSource.destroy();
  });

  it('recovery code واحد بيتستهلك مرة واحدة بس تحت تزامن حقيقي (كان فيها سباق حقيقي قبل الإصلاح)', async () => {
    const plainCode = 'TEST-RECOVERY-CODE-1234';
    const codeHash = await bcrypt.hash(plainCode, 4); // salt rounds أقل هنا بس لسرعة الاختبار
    await dataSource.query(
      `INSERT INTO admin_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
      [realUserId, codeHash],
    );

    // 5 محاولات متزامنة حقيقية بنفس الكود الصحيح — لازم واحدة بس تنجح
    const results = await Promise.all(
      Array.from({ length: 5 }, () => webAuthnService.consumeRecoveryCode(realUserId, plainCode)),
    );
    const successCount = results.filter(Boolean).length;
    expect(successCount).toBe(1);

    // وبعدين حتى محاولة منفردة بعد كده لازم ترفض (الكود اتستهلك بالفعل)
    const afterConsumed = await webAuthnService.consumeRecoveryCode(realUserId, plainCode);
    expect(afterConsumed).toBe(false);
  });

  it('كود استرجاع غلط دايمًا بيترفض (مش بيتقارن بأي كود آخر بالغلط)', async () => {
    const result = await webAuthnService.consumeRecoveryCode(realUserId, 'WRONG-CODE-0000');
    expect(result).toBe(false);
  });

  it('step-up token بيتستهلك مرة واحدة بس تحت تزامن حقيقي', async () => {
    const { token } = await stepUpService.issue(realUserId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => stepUpService.consume(realUserId, token)),
    );
    const successCount = results.filter(Boolean).length;
    expect(successCount).toBe(1);
  });

  it('step-up token بتاع مستخدم مش قادر يتستهلك بمعرّف مستخدم مختلف (منع سرقة/استخدام عبر حسابات)', async () => {
    const { token } = await stepUpService.issue(realUserId);
    const consumedByWrongUser = await stepUpService.consume(userId1, token);
    expect(consumedByWrongUser).toBe(false);

    // ولسه المستخدم الصح يقدر يستهلكه (التوكن لسه صالح، محاولة المستخدم الغلط ماحرقتوش)
    const consumedByRightUser = await stepUpService.consume(realUserId, token);
    expect(consumedByRightUser).toBe(true);
  });

  it('step-up token منتهي الصلاحية بيترفض حتى لو مستخدم مرة واحدة بس', async () => {
    const { token } = await stepUpService.issue(realUserId);
    // نصطنع انتهاء الصلاحية يدويًا (بدل ما ننتظر دقيقتين حقيقيتين)
    await dataSource.query(`UPDATE step_up_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`, [token]);
    const consumed = await stepUpService.consume(realUserId, token);
    expect(consumed).toBe(false);
  });
});
