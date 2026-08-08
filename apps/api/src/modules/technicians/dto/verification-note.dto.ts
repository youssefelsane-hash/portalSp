import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VerificationNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
