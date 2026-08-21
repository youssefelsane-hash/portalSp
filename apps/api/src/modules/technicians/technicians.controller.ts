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
import { PreferredCrewService } from './preferred-crew.service';
import { InvitePreferredCrewMemberDto } from './dto/invite-preferred-crew-member.dto';
import { toPreferredCrewMemberResponseDto } from './dto/preferred-crew-member-response.dto';
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
import { SelfDeclareCategoryDto } from './dto/self-declare-category.dto';
import { toTechnicianServiceResponseDto } from './dto/technician-service-response.dto';
import { toTechnicianCategoryResponseDto } from './dto/technician-category-response.dto';
import { TechnicianCategoriesService } from './technician-categories.service';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { BulkSetAvailabilityDto } from './dto/bulk-set-availability.dto';

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
    private readonly technicianCategoriesService: TechnicianCategoriesService,
    private readonly preferredCrewService: PreferredCrewService,
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

  // الفريق المفضّل (docs/08 §36.16، ADR-0022) — شبكة تفضيل نظير-لنظير دائمة، صفر موافقة أدمن.
  @Get('preferred-crew')
  async listPreferredCrew(@CurrentUser() user: JwtPayload) {
    const rows = await this.preferredCrewService.listMine(user.sub);
    return rows.map(toPreferredCrewMemberResponseDto);
  }

  @Get('preferred-crew/invitations')
  async listPreferredCrewInvitations(@CurrentUser() user: JwtPayload) {
    const rows = await this.preferredCrewService.listInvitationsReceived(user.sub);
    return rows.map(toPreferredCrewMemberResponseDto);
  }

  @Post('preferred-crew')
  async invitePreferredCrewMember(@CurrentUser() user: JwtPayload, @Body() dto: InvitePreferredCrewMemberDto) {
    const row = await this.preferredCrewService.invite(user.sub, dto.member_technician_code);
    return { id: row.id, status: row.status };
  }

  @Post('preferred-crew/invitations/:id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptPreferredCrewInvitation(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.preferredCrewService.accept(user.sub, id);
    return { id: row.id, status: row.status };
  }

  @Post('preferred-crew/invitations/:id/decline')
  @HttpCode(HttpStatus.OK)
  async declinePreferredCrewInvitation(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.preferredCrewService.decline(user.sub, id);
    return { success: true };
  }

  @Delete('preferred-crew/:id')
  @HttpCode(HttpStatus.OK)
  async removePreferredCrewMember(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.preferredCrewService.remove(user.sub, id);
    return { success: true };
  }

  @Post('preferred-crew/:id/leave')
  @HttpCode(HttpStatus.OK)
  async leavePreferredCrew(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.preferredCrewService.leave(user.sub, id);
    return { success: true };
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

  // تصريح فئة/تخصص ذاتي (ADR-0018 §8) — نفس فلسفة "services" فوق بالحرف بس على مستوى فئة كاملة
  // (سباكة، كهرباء...) مش خدمة واحدة. اعتماد الفئة بيديه أهلية تلقائية لكل خدماتها (راجع
  // matching/README.md وtechnicians/README.md للتفصيل الكامل).
  @Get('categories')
  async listMyCategories(@CurrentUser() user: JwtPayload) {
    const rows = await this.technicianCategoriesService.listMyCategories(user.sub);
    return rows.map((row) => toTechnicianCategoryResponseDto(row));
  }

  @Post('categories')
  async declareCategory(@CurrentUser() user: JwtPayload, @Body() dto: SelfDeclareCategoryDto) {
    return toTechnicianCategoryResponseDto(await this.technicianCategoriesService.declareCategory(user.sub, dto));
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  async withdrawCategory(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.technicianCategoriesService.withdrawCategory(user.sub, id);
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

  // تعديل جماعي سريع للإتاحة (docs/08 §34.3) — نطاق تاريخ/أسبوع/شهر كامل بنداء واحد بدل يوم
  // بيوم. توسيع النطاق (from→to) لقائمة تواريخ بيحصل هنا في الـcontroller (طبقة عرض بسيطة)،
  // مش في الـservice، عشان الـservice يفضل عامل بس على قايمة تواريخ صريحة.
  @Post('schedule/bulk')
  @HttpCode(HttpStatus.OK)
  async bulkSetAvailability(@CurrentUser() user: JwtPayload, @Body() dto: BulkSetAvailabilityDto) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const results = await this.scheduleService.bulkSetAvailability(profile.id, dto.dates, dto.action, dto.notes_ar);
    return { results };
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
