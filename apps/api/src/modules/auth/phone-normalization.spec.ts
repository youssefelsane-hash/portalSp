import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OtpPurpose } from './entities/otp-code.entity';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RecoveryVerifyDto } from './dto/recovery-verify.dto';
import { UserType } from './entities/user.entity';

describe('Auth phone identity normalization', () => {
  it.each([
    [RequestOtpDto, { phone_number: '+20 100 123 4567', purpose: OtpPurpose.LOGIN }],
    [RegisterDto, { phone_number: '+20 100 123 4567', otp_code: '123456', full_name: 'Test User', user_type: UserType.CUSTOMER }],
    [VerifyOtpDto, { phone_number: '+20 100 123 4567', otp_code: '123456' }],
    [RecoveryVerifyDto, { phone_number: '+20 100 123 4567', otp_code: '123456', recovery_code: 'AAAA-BBBB-CCCC' }],
  ])('%p canonicalizes equivalent phone formatting before validation', async (Dto, input) => {
    const dto = plainToInstance(Dto as new () => { phone_number: string }, input);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.phone_number).toBe('+201001234567');
  });
});
