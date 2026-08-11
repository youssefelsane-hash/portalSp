import { IsString, Length } from 'class-validator';

export class RequestAssistantDto {
  @IsString()
  @Length(3, 20)
  assistant_technician_code: string;
}
