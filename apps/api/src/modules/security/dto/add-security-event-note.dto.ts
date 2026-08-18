import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddSecurityEventNoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note: string;
}
