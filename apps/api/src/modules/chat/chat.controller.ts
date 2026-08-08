import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { toMessageResponseDto } from './dto/message-response.dto';
import { toThreadResponseDto } from './dto/thread-response.dto';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Get('orders/:orderId/thread')
  async getThreadForOrder(@CurrentUser() user: JwtPayload, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return toThreadResponseDto(await this.chatService.getThreadForOrder(user.sub, orderId));
  }

  @Get('threads/:id/messages')
  async listMessages(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const messages = await this.chatService.listMessages(user.sub, id);
    return messages.map(toMessageResponseDto);
  }

  @Post('threads/:id/messages')
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return toMessageResponseDto(await this.chatService.sendMessage(user.sub, id, dto));
  }

  // نفس نمط POST /technician/orders/:id/media بالظبط — multipart مباشر، مش presigned URL.
  // عكس POST .../messages (نص) اللي مش بيبث عبر WebSocket، هنا بنبث يدوياً بعد الحفظ — الاتنين
  // (عميل/فني) فاتحين الشات وواصلين بالسوكيت بالفعل وقت رفع صورة، فمن غير بث كانوا مش هيشوفوها
  // إلا لو قفلوا الشاشة وفتحوها تاني. مفيش داعي WS مباشر للرفع نفسه — Socket.IO مش مناسب لملفات
  // ثنائية بنفس بساطة multipart HTTP.
  @Post('threads/:id/messages/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async sendImageMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الملف غير مسموح — صور JPEG/PNG/WEBP بس');
    }

    const message = await this.chatService.sendImageMessage(user.sub, id, file);
    const dto = toMessageResponseDto(message);
    this.chatGateway.server.to(`thread:${id}`).emit('chat:message_received', dto);
    return dto;
  }
}
