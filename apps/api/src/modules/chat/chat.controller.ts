import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { toMessageResponseDto } from './dto/message-response.dto';

@Controller('chat/threads')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get(':id/messages')
  async listMessages(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const messages = await this.chatService.listMessages(user.sub, id);
    return messages.map(toMessageResponseDto);
  }

  @Post(':id/messages')
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return toMessageResponseDto(await this.chatService.sendMessage(user.sub, id, dto));
  }
}
