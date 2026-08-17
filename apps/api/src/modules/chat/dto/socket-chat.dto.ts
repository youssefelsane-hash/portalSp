import { IsUUID } from 'class-validator';
import { SendMessageDto } from './send-message.dto';

export class JoinChatThreadDto {
  @IsUUID()
  thread_id: string;
}

export class SocketSendMessageDto extends SendMessageDto {
  @IsUUID()
  thread_id: string;
}
