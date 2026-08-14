import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechnicianCertificatesService } from './technician-certificates.service';
import { toAdminTechnicianDetailResponseDto, toAdminTechnicianResponseDto } from './dto/admin-technician-response.dto';
import { AssignTechnicianZoneDto } from './dto/assign-technician-zone.dto';
import { ChangeTechnicianLevelDto } from './dto/change-technician-level.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { RejectTechnicianDto } from './dto/reject-technician.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { ReviewCertificateDto } from './dto/review-certificate.dto';
import { SuspendTechnicianDto } from './dto/suspend-technician.dto';
import { toTechnicianDocumentResponseDto } from './dto/technician-document-response.dto';
import { toCertificateResponseDto } from './dto/certificate-response.dto';
import { toTechnicianZoneResponseDto } from './dto/technician-zone-response.dto';
import { VerificationNoteDto } from './dto/verification-note.dto';

@Controller('admin/technicians')
@Roles(UserType.ADMIN)
export class AdminTechniciansController {
  constructor(
    private readonly adminTechniciansService: AdminTechniciansService,
    private readonly certificatesService: TechnicianCertificatesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get()
  async list(@Query() query: ListTechniciansQueryDto) {
    const { items, meta } = await this.adminTechniciansService.list(query);
    return { items: items.map(({ profile, user }) => toAdminTechnicianResponseDto(profile, user)), meta };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { profile, user, documents } = await this.adminTechniciansService.getDetail(id);
    const certificates = await this.certificatesService.listForTechnician(id);
    return toAdminTechnicianDetailResponseDto(profile, user, documents, certificates, this.storage);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async approve(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.approve(admin.sub, id, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async reject(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTechnicianDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.reject(admin.sub, id, dto.reason, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async suspend(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendTechnicianDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.suspend(admin.sub, id, dto.reason, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  // كانت فجوة موثّقة صراحة: الحالات الوسيطة (documents_submitted/under_review/
  // interview_scheduled/test_passed) معرّفة في القاموس بس مفيش endpoints تحرّك الفني بينهم.
  @Post(':id/mark-documents-submitted')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async markDocumentsSubmitted(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationNoteDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.markDocumentsSubmitted(admin.sub, id, dto.notes, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/mark-under-review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async markUnderReview(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationNoteDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.markUnderReview(admin.sub, id, dto.notes, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/schedule-interview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async scheduleInterview(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationNoteDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.scheduleInterview(admin.sub, id, dto.notes, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/mark-test-passed')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async markTestPassed(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationNoteDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.markTestPassed(admin.sub, id, dto.notes, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Patch(':id/level')
  @RequirePermission('technicians.approve')
  async changeLevel(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTechnicianLevelDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.changeLevel(admin.sub, id, dto, audit);
    return toAdminTechnicianResponseDto(profile, user);
  }

  @Post(':id/documents/:documentId/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.review_documents')
  async reviewDocument(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const document = await this.adminTechniciansService.reviewDocument(admin.sub, id, documentId, dto, audit);
    return toTechnicianDocumentResponseDto(document, this.storage);
  }

  // مراجعة شهادات/كورسات الفني (docs/08 §4) — نفس صلاحية مراجعة مستندات الـ KYC، عشان هي أصلاً
  // نفس نوع القرار (approve/reject على مستند مرفوع من الفني قبل ما يبان لحد تاني).
  @Post(':id/certificates/:certificateId/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.review_documents')
  async reviewCertificate(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @Body() dto: ReviewCertificateDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const certificate = await this.certificatesService.review(admin.sub, id, certificateId, dto, audit);
    return toCertificateResponseDto(certificate);
  }

  // كانت فجوة موثّقة صراحة: تعيين مناطق عمل الفني كان يدوي عبر SQL مباشر تماماً.
  @Get(':id/zones')
  async listZones(@Param('id', ParseUUIDPipe) id: string) {
    const zones = await this.adminTechniciansService.listZones(id);
    return zones.map(toTechnicianZoneResponseDto);
  }

  @Post(':id/zones')
  @RequirePermission('technicians.manage_zones')
  async assignZone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTechnicianZoneDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toTechnicianZoneResponseDto(await this.adminTechniciansService.assignZone(admin.sub, id, dto, audit));
  }

  @Delete(':id/zones/:zoneId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.manage_zones')
  async removeZone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminTechniciansService.removeZone(admin.sub, id, zoneId, audit);
    return { service_zone_id: zoneId, removed: true };
  }

  // "معاه مساعد؟" (docs/06 §3.7) — نفس صلاحية اعتماد الفني (technicians.approve)، قرار مشابه بالطبيعة.
  @Post(':id/assistant/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async approveAssistant(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    const profile = await this.adminTechniciansService.approveAssistant(admin.sub, id, audit);
    return { assistant_link_status: profile.assistantLinkStatus, assistant_technician_id: profile.assistantTechnicianId };
  }

  @Post(':id/assistant/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async rejectAssistant(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    const profile = await this.adminTechniciansService.rejectAssistant(admin.sub, id, audit);
    return { assistant_link_status: profile.assistantLinkStatus, assistant_technician_id: profile.assistantTechnicianId };
  }
}
