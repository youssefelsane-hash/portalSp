import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { ChatService } from './chat.service';
import { toAdminSupportThreadResponseDto } from './dto/admin-support-thread-response.dto';

// كانت فجوة موثّقة صراحة ("support_chat موجود بس مفيش endpoint بيستخدمه") — إشراف الأدمن على
// خيوط الدعم العام. القراءة والرد الفعلي بيحصلوا عبر GET/POST /chat/threads/:id/messages
// العاديين (ChatService.resolveParticipant بقى بيقبل أي أدمن عنده support_tickets.manage كطرف
// صالح في أي خيط support_chat تحديداً — تفاصيل كاملة في chat/README.md)، هنا بس القايمة.
@Controller('admin/support-chat-threads')
@Roles(UserType.ADMIN)
export class AdminChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @RequirePermission('support_tickets.manage')
  async list() {
    const rows = await this.chatService.listSupportThreadsForAdmin();
    return rows.map(toAdminSupportThreadResponseDto);
  }
}
