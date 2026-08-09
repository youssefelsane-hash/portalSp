import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTechnicianProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}
