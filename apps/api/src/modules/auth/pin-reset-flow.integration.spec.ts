import { randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { User, UserType } from './entities/user.entity';
import { PinResetToken } from './entities/pin-reset-token.entity';
import { issuePinSetupCode } from './pin-setup';
import { verifyPinHash } from './login-pin.policy';

describe('PIN reset code issuance and redemption', () => {
  let dataSource: DataSource;
  let auth: AuthService;
  const userIds: string[] = [];
  const pepper = 'integration-test-pin-pepper';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, PinResetToken],
    });
    await dataSource.initialize();
    const config = { get: (key: string) => key === 'auth.pinPepper' ? pepper : undefined } as ConfigService;
    auth = new AuthService(
      dataSource.getRepository(User),
      null as never,
      null as never,
      null as never,
      dataSource,
      null as never,
      config,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (userIds.length) {
        await dataSource.query('DELETE FROM pin_reset_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
        await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      }
      await dataSource.destroy();
    }
  });

  async function createUser(userType: UserType): Promise<{ id: string; phone: string }> {
    const phone = `+2011${randomInt(10_000_000, 100_000_000)}`;
    const [row] = await dataSource.query<{ id: string }[]>(
      'INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, $3) RETURNING id',
      [phone, 'PIN reset integration test', userType],
    );
    userIds.push(row.id);
    return { id: row.id, phone };
  }

  it.each([UserType.CUSTOMER, UserType.TECHNICIAN])(
    'redeems the newest admin-issued code for a %s and rejects reuse',
    async (userType) => {
      const user = await createUser(userType);
      const first = await dataSource.transaction((manager) => issuePinSetupCode(manager, {
        userId: user.id,
        issuedByUserId: user.id,
        clearExistingPin: true,
      }));
      const second = await dataSource.transaction((manager) => issuePinSetupCode(manager, {
        userId: user.id,
        issuedByUserId: user.id,
        clearExistingPin: true,
      }));
      const pin = '296418';

      await expect(auth.redeemPinResetCode({ phone_number: user.phone, reset_code: first.code, pin }))
        .rejects.toThrow('كود الاسترجاع غلط أو انتهى');
      await expect(auth.redeemPinResetCode({ phone_number: user.phone, reset_code: second.code, pin }))
        .resolves.toEqual({ pin_set: true });
      await expect(auth.redeemPinResetCode({ phone_number: user.phone, reset_code: second.code, pin }))
        .rejects.toThrow('كود الاسترجاع غلط أو انتهى');

      const [saved] = await dataSource.query<{ pin_hash: string }[]>(
        'SELECT pin_hash FROM users WHERE id = $1',
        [user.id],
      );
      expect(await verifyPinHash(pin, saved.pin_hash, pepper)).toBe(true);
    },
  );

  it('binds the code to the exact phone account', async () => {
    const owner = await createUser(UserType.CUSTOMER);
    const other = await createUser(UserType.CUSTOMER);
    const { code } = await dataSource.transaction((manager) => issuePinSetupCode(manager, {
      userId: owner.id,
      issuedByUserId: owner.id,
      clearExistingPin: true,
    }));

    await expect(auth.redeemPinResetCode({ phone_number: other.phone, reset_code: code, pin: '296418' }))
      .rejects.toThrow('كود الاسترجاع غلط أو انتهى');
    await expect(auth.redeemPinResetCode({ phone_number: owner.phone, reset_code: code, pin: '296418' }))
      .resolves.toEqual({ pin_set: true });
  });
});
