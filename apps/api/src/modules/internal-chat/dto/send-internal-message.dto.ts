import { IsString, Length } from 'class-validator';

export class SendInternalMessageDto {
  @IsString()
  @Length(1, 2000)
  content: string;
}
