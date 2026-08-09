import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { SendInternalMessageDto } from './dto/send-internal-message.dto';
import { StartInternalThreadDto } from './dto/start-internal-thread.dto';
import { toInternalContactResponseDto } from './dto/internal-contact-response.dto';
import { toInternalMessageResponseDto } from './dto/internal-message-response.dto';
import { toInternalThreadResponseDto } from './dto/internal-thread-response.dto';
import { InternalChatService } from './internal-chat.service';

// شات داخلي بين موظفين وفنيين — منفصل تماماً عن chat (شات الطلب/الدعم العام للعملاء).
// متاح لأي أدمن أو فني (@Roles على مستوى method مش controller، لأن الاتنين مسموحين هنا بعكس
// كل الشات التاني اللي مقصور على نوع مستخدم واحد).
@Controller('internal-chat')
export class InternalChatController {
  constructor(private readonly internalChatService: InternalChatService) {}

  @Get('contacts')
  @Roles(UserType.ADMIN, UserType.TECHNICIAN)
  async listContacts(@CurrentUser() user: JwtPayload) {
    const contacts = await this.internalChatService.listContactsFor(user.sub);
    return contacts.map(toInternalContactResponseDto);
  }

  @Get('threads')
  @Roles(UserType.ADMIN, UserType.TECHNICIAN)
  async listThreads(@CurrentUser() user: JwtPayload) {
    const rows = await this.internalChatService.listThreadsForUser(user.sub);
    return rows.map(toInternalThreadResponseDto);
  }

  @Post('threads')
  @Roles(UserType.ADMIN, UserType.TECHNICIAN)
  async startThread(@CurrentUser() user: JwtPayload, @Body() dto: StartInternalThreadDto) {
    const [thread, peer] = await Promise.all([
      this.internalChatService.getOrCreateThread(user.sub, dto.peer_user_id),
      this.internalChatService.getContact(dto.peer_user_id),
    ]);
    return toInternalThreadResponseDto({ thread, peer });
  }

  @Get('threads/:id/messages')
  @Roles(UserType.ADMIN, UserType.TECHNICIAN)
  async listMessages(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const messages = await this.internalChatService.listMessages(user.sub, id);
    return messages.map(toInternalMessageResponseDto);
  }

  @Post('threads/:id/messages')
  @Roles(UserType.ADMIN, UserType.TECHNICIAN)
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInternalMessageDto,
  ) {
    const message = await this.internalChatService.sendMessage(user.sub, id, dto);
    return toInternalMessageResponseDto(message);
  }
}
