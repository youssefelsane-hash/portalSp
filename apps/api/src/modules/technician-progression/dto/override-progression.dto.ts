import { IsString, Length } from 'class-validator';

export class OverrideProgressionDto {
  @IsString()
  @Length(10, 500)
  reason: string;
}
