import { IsInt, IsPositive } from 'class-validator';

export class ManualLoyaltyCreditDto {
  @IsInt()
  @IsPositive()
  points: number;
}
