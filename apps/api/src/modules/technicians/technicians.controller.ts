import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { assertFileSignatureMatches } from '../../common/storage/file-signature-validator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { TechnicianScheduleService } from './technician-schedule.service';
import { PortfolioLinksService } from './portfolio-links.service';
import { TechnicianCertificatesService } from './technician-certificates.service';
import { toTechnicianProfileResponseDto } from './dto/technician-profile-response.dto';
import { toTechnicianDocumentResponseDto } from './dto/technician-document-response.dto';
import { toPortfolioLinkResponseDto } from './dto/portfolio-link-response.dto';
import { toScheduleSlotResponseDto } from './dto/schedule-slot-response.dto';
import { toCertificateResponseDto } from './dto/certificate-response.dto';
import { AddPortfolioLinkDto } from './dto/add-portfolio-link.dto';
import { AddCertificateDto } from './dto/add-certificate.dto';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { RequestAssistantDto } from './dto/request-assistant.dto';
import { SelfDeclareServiceDto } from './dto/self-declare-service.dto';
import { toTechnicianServiceResponseDto } from './dto/technician-service-response.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@Controller('technician')
@Roles(UserType.TECHNICIAN)
export class TechniciansController {
  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly technicianDocumentsService: TechnicianDocumentsService,
    private readonly portfolioLinksService: PortfolioLinksService,
    private readonly scheduleService: TechnicianScheduleService,
    private readonly certificatesService: TechnicianCertificatesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
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

  // تصريح مهارات ذاتي (Script 4 §2-7) — كانت فجوة موثّقة صراحة: technician_services كان 100%
  // معيّن من الأدمن، الفني مالوش أي مسار يطلب خدمة بنفسه. التصريح لوحده مايديش أهلية مطابقة
  // فورية (verification_status='pending_verification') — راجع technicians.service.ts.
  @Get('services')
  async listMyServices(@CurrentUser() user: JwtPayload) {
    const rows = await this.techniciansService.listMyServices(user.sub);
    return rows.map((row) => toTechnicianServiceResponseDto(row));
  }

  @Post('services')
  async declareService(@CurrentUser() user: JwtPayload, @Body() dto: SelfDeclareServiceDto) {
    return toTechnicianServiceResponseDto(await this.techniciansService.declareService(user.sub, dto));
  }

  @Delete('services/:id')
  @HttpCode(HttpStatus.OK)
  async withdrawService(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.techniciansService.withdrawService(user.sub, id);
    return { id, withdrawn: true };
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
    assertFileSignatureMatches(file.buffer, file.mimetype, ALLOWED_DOCUMENT_MIME_TYPES);

    const document = await this.technicianDocumentsService.upload(user.sub, dto, file);
    return toTechnicianDocumentResponseDto(document, this.storage);
  }

  @Get('documents')
  async listDocuments(@CurrentUser() user: JwtPayload) {
    const documents = await this.technicianDocumentsService.listMine(user.sub);
    return Promise.all(documents.map((d) => toTechnicianDocumentResponseDto(d, this.storage)));
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

  // جدولة الفني الحقيقية (docs/08 §2، ADR-0002) — الفني بيدير سلوتاته بنفسه (متاح/إجازة)،
  // العميل بيشوفها للحجز عبر public-technicians.controller.ts (أخضر/أحمر بس، بدون تفاصيل داخلية).
  @Get('schedule')
  async listSchedule(@CurrentUser() user: JwtPayload, @Query() query: ScheduleQueryDto) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const slots = await this.scheduleService.listForTechnician(profile.id, query.from, query.to);
    return slots.map(toScheduleSlotResponseDto);
  }

  @Post('schedule')
  async createScheduleSlot(@CurrentUser() user: JwtPayload, @Body() dto: CreateScheduleSlotDto) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return toScheduleSlotResponseDto(await this.scheduleService.createSlot(profile.id, dto));
  }

  @Delete('schedule/:id')
  @HttpCode(HttpStatus.OK)
  async deleteScheduleSlot(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    await this.scheduleService.deleteSlot(profile.id, id);
    return { id, deleted: true };
  }

  // شهادات/كورسات الفني (docs/08 §4) — تسويقية بالكامل، لازم مراجعة أدمن (approve/reject) قبل
  // ما تبان في البروفايل العام. تفاصيل كاملة في technicians/README.md.
  @Get('certificates')
  async listCertificates(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const certificates = await this.certificatesService.listForTechnician(profile.id);
    return Promise.all(certificates.map((c) => toCertificateResponseDto(c, this.storage)));
  }

  @Post('certificates')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  async addCertificate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AddCertificateDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    assertFileSignatureMatches(file.buffer, file.mimetype, ALLOWED_DOCUMENT_MIME_TYPES);

    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const certificate = await this.certificatesService.add(profile.id, dto, file);
    return toCertificateResponseDto(certificate, this.storage);
  }

  @Delete('certificates/:id')
  @HttpCode(HttpStatus.OK)
  async removeCertificate(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    await this.certificatesService.remove(profile.id, id);
    return null;
  }
}
