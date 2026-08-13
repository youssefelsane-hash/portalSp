import { IsString, Length } from 'class-validator';

export class AttributeReferralDto {
  @IsString()
  @Length(2, 20)
  referral_code: string;
}
