import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { PortfolioLinksService } from './portfolio-links.service';
import { toTechnicianProfileResponseDto } from './dto/technician-profile-response.dto';
import { toTechnicianDocumentResponseDto } from './dto/technician-document-response.dto';
import { toPortfolioLinkResponseDto } from './dto/portfolio-link-response.dto';
import { AddPortfolioLinkDto } from './dto/add-portfolio-link.dto';
import { RequestAssistantDto } from './dto/request-assistant.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@Controller('technician')
@Roles(UserType.TECHNICIAN)
export class TechniciansController {
  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly technicianDocumentsService: TechnicianDocumentsService,
    private readonly portfolioLinksService: PortfolioLinksService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    // تصنيف نوع الفني الأربعة (docs/06 §3.8) — محسوب لحظياً من بيانات موجودة (مش عمود مخزّن)،
    // راجع technicians/README.md.
    const technicianType = await this.techniciansService.classifyType(profile);
    return {
      ...toTechnicianProfileResponseDto(profile),
      technician_type: technicianType,
      assistant_link_status: profile.assistantLinkStatus,
      assistant_technician_id: profile.assistantTechnicianId,
    };
  }

  // "معاه مساعد؟" (docs/06 §3.7) — الفني بيطلب ربط مساعد بكود موظفه، الإدارة توافق قبل ما
  // يبقى رسمي (POST /admin/technicians/:id/assistant/approve|reject).
  @Post('assistant-request')
  async requestAssistant(@CurrentUser() user: JwtPayload, @Body() dto: RequestAssistantDto) {
    const profile = await this.techniciansService.requestAssistant(user.sub, dto.assistant_technician_code);
    return { assistant_link_status: profile.assistantLinkStatus, assistant_technician_id: profile.assistantTechnicianId };
  }

  @Delete('assistant')
  @HttpCode(HttpStatus.OK)
  async removeAssistant(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.removeAssistant(user.sub);
    return { assistant_link_status: profile.assistantLinkStatus, assistant_technician_id: profile.assistantTechnicianId };
  }

  @Get('level')
  async getLevel(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return { current_level: profile.currentLevel, quality_score: Number(profile.qualityScore) };
  }

  @Patch('availability')
  async updateAvailability(@CurrentUser() user: JwtPayload, @Body() dto: UpdateAvailabilityDto) {
    return toTechnicianProfileResponseDto(await this.techniciansService.updateAvailability(user.sub, dto));
  }

  // كانت فجوة موثّقة — عمود bio موجود في الـ schema من أول يوم بس مش متربط في الـ entity ولا
  // عنده أي endpoint. أول استخدام حقيقي: نبذة الفني في بروفايله العام (راجع technicians/README.md).
  @Patch('profile')
  async updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateTechnicianProfileDto) {
    return toTechnicianProfileResponseDto(await this.techniciansService.updateProfile(user.sub, dto));
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  async updateLocation(@CurrentUser() user: JwtPayload, @Body() dto: UpdateLocationDto) {
    await this.techniciansService.updateLocation(user.sub, dto);
    return null;
  }

  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  async uploadDocument(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('نوع الملف غير مسموح — صور JPEG/PNG/WEBP أو PDF بس');
    }

    const document = await this.technicianDocumentsService.upload(user.sub, dto, file);
    return toTechnicianDocumentResponseDto(document);
  }

  @Get('documents')
  async listDocuments(@CurrentUser() user: JwtPayload) {
    const documents = await this.technicianDocumentsService.listMine(user.sub);
    return documents.map(toTechnicianDocumentResponseDto);
  }

  // معرض أعمال الفني عبر لينكات السوشيال ميديا — تفاصيل كاملة في technicians/README.md.
  @Get('portfolio-links')
  async listPortfolioLinks(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const links = await this.portfolioLinksService.listForTechnician(profile.id);
    return links.map(toPortfolioLinkResponseDto);
  }

  @Post('portfolio-links')
  async addPortfolioLink(@CurrentUser() user: JwtPayload, @Body() dto: AddPortfolioLinkDto) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return toPortfolioLinkResponseDto(await this.portfolioLinksService.addLink(profile.id, dto));
  }

  @Delete('portfolio-links/:id')
  @HttpCode(HttpStatus.OK)
  async removePortfolioLink(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    await this.portfolioLinksService.remove(profile.id, id);
    return null;
  }
}
