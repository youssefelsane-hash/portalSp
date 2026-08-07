import { IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  full_name?: string;

  @IsOptional()
  @IsUrl()
  avatar_url?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferred_language?: string;
}
