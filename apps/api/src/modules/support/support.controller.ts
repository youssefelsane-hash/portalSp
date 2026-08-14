import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toComplaintAttachmentResponseDto } from './dto/complaint-attachment-response.dto';
import { AddComplaintMessageDto, FileComplaintDto } from './dto/file-complaint.dto';
import { toComplaintMessageResponseDto, toComplaintResponseDto } from './dto/complaint-response.dto';
import { SupportService } from './support.service';

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — نفس حد صور الطلبات

// فتح الشكوى بس مقصور على العميل/الفني (الطرفين اللي فعلاً بيشتكوا) — القراءة والرد مفتوحين
// للأدمن كمان على مستوى كل method لوحده، عشان فريق الدعم يقدر يشوف ويرد من نفس المسارات.
@Controller('complaints')
@Roles(UserType.CUSTOMER, UserType.TECHNICIAN)
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Post()
  async file(@CurrentUser() user: JwtPayload, @Body() dto: FileComplaintDto) {
    return toComplaintResponseDto(await this.supportService.fileComplaint(user, dto));
  }

  @Get()
  async listMine(@CurrentUser() user: JwtPayload) {
    const complaints = await this.supportService.listMine(user.sub);
    return complaints.map(toComplaintResponseDto);
  }

  @Get(':id')
  @Roles(UserType.CUSTOMER, UserType.TECHNICIAN, UserType.ADMIN)
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toComplaintResponseDto(await this.supportService.getForUser(user, id));
  }

  @Post(':id/messages')
  @Roles(UserType.CUSTOMER, UserType.TECHNICIAN, UserType.ADMIN)
  async addMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddComplaintMessageDto,
  ) {
    return toComplaintMessageResponseDto(await this.supportService.addMessage(user, id, dto));
  }

  @Get(':id/messages')
  @Roles(UserType.CUSTOMER, UserType.TECHNICIAN, UserType.ADMIN)
  async listMessages(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const messages = await this.supportService.listMessages(user, id);
    return messages.map(toComplaintMessageResponseDto);
  }

  @Post(':id/attachments')
  @Roles(UserType.CUSTOMER, UserType.TECHNICIAN, UserType.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES },
    }),
  )
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الملف غير مسموح — صور JPEG/PNG/WEBP بس');
    }

    const attachment = await this.supportService.uploadAttachment(user, id, file);
    return toComplaintAttachmentResponseDto(attachment, this.storage);
  }

  @Get(':id/attachments')
  @Roles(UserType.CUSTOMER, UserType.TECHNICIAN, UserType.ADMIN)
  async listAttachments(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const attachments = await this.supportService.listAttachments(user, id);
    return Promise.all(attachments.map((a) => toComplaintAttachmentResponseDto(a, this.storage)));
  }
}
