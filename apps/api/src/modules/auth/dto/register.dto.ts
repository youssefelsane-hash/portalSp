import { IsIn, IsPhoneNumber, IsString, Length } from 'class-validator';
import { UserType } from '../entities/user.entity';

export class RegisterDto {
  @IsPhoneNumber(undefined)
  phone_number: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;

  @IsString()
  @Length(2, 120)
  full_name: string;

  // التسجيل الذاتي مسموح بس للعميل أو الفني — الأدمن يتضاف يدوياً من لوحة التحكم
  @IsIn([UserType.CUSTOMER, UserType.TECHNICIAN])
  user_type: UserType.CUSTOMER | UserType.TECHNICIAN;
}
