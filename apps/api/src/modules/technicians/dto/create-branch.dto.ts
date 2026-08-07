import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @Length(2, 160)
  name: string;

  @IsOptional()
  @IsUUID()
  area_id?: string;

  @IsOptional()
  @IsString()
  address_line?: string;
}
