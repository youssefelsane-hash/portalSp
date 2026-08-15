import { IsString, Length } from 'class-validator';

export class ReportCashNotReceivedDto {
  @IsString()
  @Length(10, 2000)
  description: string;
}
