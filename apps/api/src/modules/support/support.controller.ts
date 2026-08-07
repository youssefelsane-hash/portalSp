import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddComplaintMessageDto, FileComplaintDto } from './dto/file-complaint.dto';
import { toComplaintMessageResponseDto, toComplaintResponseDto } from './dto/complaint-response.dto';
import { SupportService } from './support.service';

// فتح الشكوى بس مقصور على العميل/الفني (الطرفين اللي فعلاً بيشتكوا) — القراءة والرد مفتوحين
// للأدمن كمان على مستوى كل method لوحده، عشان فريق الدعم يقدر يشوف ويرد من نفس المسارات.
@Controller('complaints')
@Roles(UserType.CUSTOMER, UserType.TECHNICIAN)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

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
}
