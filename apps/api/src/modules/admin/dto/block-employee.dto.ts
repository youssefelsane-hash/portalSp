import { IsString, Length } from 'class-validator';

export class BlockEmployeeDto {
  @IsString()
  @Length(3, 300)
  reason: string;
}
