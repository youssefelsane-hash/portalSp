import { IsString, Length } from 'class-validator';

export class RejectEarningApprovalDto {
  @IsString()
  @Length(2, 500)
  reason: string;
}
