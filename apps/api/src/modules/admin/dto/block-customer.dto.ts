import { IsString, Length } from 'class-validator';

export class BlockCustomerDto {
  @IsString()
  @Length(3, 300)
  reason: string;
}
