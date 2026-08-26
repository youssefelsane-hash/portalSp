import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { ChangeTechnicianPricingTierDto } from './dto/change-technician-pricing-tier.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { RejectTechnicianDto } from './dto/reject-technician.dto';
import { ApproveTechnicianServiceDto, RejectTechnicianServiceDto } from './dto/review-technician-service.dto';
import { toTechnicianServiceResponseDto } from './dto/technician-service-response.dto';
import { RejectTechnicianCategoryDto } from './dto/review-technician-category.dto';
import { SelfDeclareCategoryDto } from './dto/self-declare-category.dto';
import { toTechnicianCategoryResponseDto } from './dto/technician-category-response.dto';
import { TechnicianCategoriesService } from './technician-categories.service';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { ReviewCertificateDto } from './dto/review-certificate.dto';
import { SuspendTechnicianDto } from './dto/suspend-technician.dto';
import { toTechnicianDocumentResponseDto } from './dto/technician-document-response.dto';
import { toCertificateResponseDto } from './dto/certificate-response.dto';
import { toTechnicianZoneResponseDto } from './dto/technician-zone-response.dto';
import { VerificationNoteDto } from './dto/verification-note.dto';
import { TechnicianCapacityQueryDto } from './dto/technician-capacity-query.dto';
import { describeTechnicianCapacity } from './technician-eligibility.sql';
import { SettingsService } from '../settings/settings.service';
import { TechnicianActivityService } from './technician-activity.service';
import { AdminTechnicianCategoryOpsService } from './admin-technician-category-ops.service';
import { ListCategoryOpsQueryDto } from './dto/list-category-ops-query.dto';
import { AdminTechnician360Service } from './admin-technician-360.service';
import { TechnicianEarningsService } from '../payments/technician-earnings.service';

const FULL_DAY_JOB_MINUTES_FALLBACK = 360;

@Controller('admin/technicians')
@Roles(UserType.ADMIN)
export class AdminTechniciansController {
  constructor(
    private readonly adminTechniciansService: AdminTechniciansService,
    private readonly certificatesService: TechnicianCertificatesService,
    private readonly technicianCategoriesService: TechnicianCategoriesService,
    private readonly settingsService: SettingsService,
    private readonly technicianActivityService: TechnicianActivityService,
    private readonly categoryOpsService: AdminTechnicianCategoryOpsService,
    private readonly technician360Service: AdminTechnician360Service,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    // ADR-0038 — آخر بند عمدًا (نفس فلسفة باقي الإضافات المتأخرة): أقل بلاست-رديوس على
    // السبيكات اللي بتبني الكولر بـpositional args.
    private readonly earningsService: TechnicianEarningsService,
  ) {}

  @Get()
  async list(@Query() query: ListTechniciansQueryDto) {
    const { items, meta } = await this.adminTechniciansService.list(query);
    const activity = await this.technicianActivityService.getActivitySnapshot(items.map(({ user }) => user.id));
    return {
      items: items.map(({ profile, user }) => {
        const snapshot = activity.get(user.id);
        return {
          ...toAdminTechnicianResponseDto(profile, user),
          online: snapshot?.online ?? false,
          last_active_at: snapshot?.lastActiveAt?.toISOString() ?? null,
        };
      }),
      meta,
    };
  }

  // مركز عمليات فئة (docs/08 §35.9، ADR-0021 §5) — "Admin → Technicians → كهرباء". مسجّل قبل
  // GET :id عمدًا (لازم يسبقها في تسجيل الـroutes، وإلا NestJS هيحاول يفسّر "by-category" كـUUID
  // لـ:id — بَقّة ترتيب routes معروفة سابقًا في المشروع، راجع matching.module.ts للسياق الكامل).
  // بلا RequirePermission مخصوصة — عرض/تشخيص بس، نفس مستوى GET :id العادي.
  @Get('by-category')
  async listByCategory(@Query() query: ListCategoryOpsQueryDto) {
    const { items, meta } = await this.categoryOpsService.list({
      categoryId: query.category_id,
      zoneId: query.zone_id,
      verificationStatus: query.verification_status,
      level: query.level,
      q: query.q,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        technician_code: r.technicianCode,
        full_name: r.fullName,
        phone_number: r.phoneNumber,
        verification_status: r.verificationStatus,
        current_level: r.currentLevel,
        online: r.online,
        last_active_at: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
        working_now: r.workingNow,
        capacity_tier_today: r.capacityTierToday,
        open_requests_count: r.openRequestsCount,
        crew_leader_shortage_count: r.crewLeaderShortageCount,
        crew_recruit_open_offers_count: r.crewRecruitOpenOffersCount,
        zone_count: r.zoneCount,
        category_count: r.categoryCount,
        has_zone_issue: r.hasZoneIssue,
        has_category_issue: r.hasCategoryIssue,
      })),
      meta: { page: meta.page, per_page: meta.perPage, total: meta.total },
    };
  }

  // بروفايل فني 360° (docs/08 §35.11، ADR-0021 §5) — تجميعة قراءة بس، صفر منطق مطوّر جديد (كل
  // فعل إداري لسه بيتعمل عبر endpoints الموجودة). بلا RequirePermission مخصوصة — نفس مستوى GET :id.
  @Get(':id/360')
  async getProfile360(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.technician360Service.getProfile(id);
    return {
      identity: {
        id: p.identity.id,
        technician_code: p.identity.technicianCode,
        full_name: p.identity.fullName,
        phone_number: p.identity.phoneNumber,
        years_of_experience: p.identity.yearsOfExperience,
        current_level: p.identity.currentLevel,
        verification_status: p.identity.verificationStatus,
        created_at: p.identity.createdAt.toISOString(),
      },
      categories: p.categories.map((c) => ({
        category_id: c.categoryId,
        name_ar: c.nameAr,
        is_active: c.isActive,
        verification_status: c.verificationStatus,
      })),
      zones: p.zones.map((z) => ({ zone_id: z.zoneId, name_ar: z.nameAr, is_active: z.isActive })),
      online: p.activity.online,
      last_active_at: p.activity.lastActiveAt ? p.activity.lastActiveAt.toISOString() : null,
      capacity_today: {
        tier: p.capacityToday.tier,
        reason_ar: p.capacityToday.reasonAr,
        occupied_from: p.capacityToday.occupiedFrom,
        occupied_to: p.capacityToday.occupiedTo,
      },
      team_role: p.teamRole
        ? { company_id: p.teamRole.companyId, company_name: p.teamRole.companyName, is_owner: p.teamRole.isOwner }
        : null,
      current_and_upcoming_jobs: p.currentAndUpcomingJobs.map((j) => ({
        order_id: j.orderId,
        order_number: j.orderNumber,
        order_status: j.orderStatus,
        scheduled_at: j.scheduledAt ? j.scheduledAt.toISOString() : null,
        service_name_ar: j.serviceNameAr,
      })),
      blocked_dates: p.blockedDates.map((b) => ({ slot_date: b.slotDate, start_time: b.startTime, end_time: b.endTime })),
      open_opportunities_count: p.openOpportunitiesCount,
      performance: {
        average_rating: p.performance.averageRating,
        total_ratings_count: p.performance.totalRatingsCount,
        completed_orders_count: p.performance.completedOrdersCount,
        cancelled_orders_count: p.performance.cancelledOrdersCount,
      },
      cancellation_behavior: {
        total_cancellations: p.cancellationBehavior.totalCancellations,
        recent_cancellations: p.cancellationBehavior.recentCancellations,
      },
      complaints: {
        open_count: p.complaints.openCount,
        total_count: p.complaints.totalCount,
        recent: p.complaints.recent.map((c) => ({
          id: c.id,
          severity: c.severity,
          status: c.status,
          created_at: c.createdAt.toISOString(),
        })),
      },
      wallet: p.wallet
        ? {
            balance_cents: p.wallet.balanceCents,
            pending_balance_cents: p.wallet.pendingBalanceCents,
            total_earned_cents: p.wallet.totalEarnedCents,
            is_frozen: p.wallet.isFrozen,
          }
        : null,
      recent_payouts: p.recentPayouts.map((r) => ({
        id: r.id,
        payout_number: r.payoutNumber,
        net_amount_cents: r.netAmountCents,
        payout_status: r.payoutStatus,
        requested_at: r.requestedAt.toISOString(),
        completed_at: r.completedAt ? r.completedAt.toISOString() : null,
      })),
      // الفريق المفضّل (docs/08 §36.19) — رؤية بس، بتُدار من الفني نفسه (/technician/preferred-crew*).
      preferred_crew_as_owner: p.preferredCrewAsOwner.map((r) => ({
        id: r.id,
        technician_id: r.technicianId,
        technician_code: r.technicianCode,
        full_name: r.fullName,
        status: r.status,
      })),
      preferred_crew_as_member: p.preferredCrewAsMember.map((r) => ({
        id: r.id,
        technician_id: r.technicianId,
        technician_code: r.technicianCode,
        full_name: r.fullName,
        status: r.status,
      })),
    };
  }

  // معاينة القدرة الاستيعابية ليوم بعينه (docs/08 §34.4، ADR-0020 §W) — "الفني ده متاح إمتى ولية؟"
  // سؤال تشخيصي عام، مش قرار مطابقة حقيقي لطلب بعينه (ده لسه بيحصل جوّه matching.service.ts وقت
  // التوزيع الفعلي). بلا RequirePermission مخصوصة — عرض بس، نفس مستوى GET :id العادي.
  @Get(':id/capacity')
  async getCapacity(@Param('id', ParseUUIDPipe) id: string, @Query() query: TechnicianCapacityQueryDto) {
    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
    const description = await describeTechnicianCapacity(this.dataSource, {
      technicianId: id,
      date: query.date,
      fullDayThresholdMinutes: fullDayJobMinutes,
    });
    return {
      technician_id: id,
      date: query.date,
      tier: description.tier,
      reason_ar: description.reasonAr,
      occupied_from: description.occupiedFrom,
      occupied_to: description.occupiedTo,
    };
  }

  /**
   * كشف مستحقات الفني الشهري من جهة الأدمن (docs/08 §61.1، ADR-0038) — **نفس الخدمة بالحرف**
   * اللي بيشوفها الفني في تطبيقه، عشان الرقمين ما يختلفوش أبدًا. بلا RequirePermission مخصوصة:
   * عرض بس، نفس مستوى `GET :id/360`.
   */
  @Get(':id/earnings/statement')
  async earningsStatement(@Param('id', ParseUUIDPipe) id: string, @Query('month') month?: string) {
    return this.earningsService.getMonthlyStatement(id, month ?? TechnicianEarningsService.currentMonthCairo());
  }

  @Get(':id/earnings/months')
  async earningsMonths(@Param('id', ParseUUIDPipe) id: string) {
    return { months: await this.earningsService.listAvailableMonths(id) };
  }

  // طابور مراجعة تصريحات المهارات الذاتية (Script 4 §2-7) — راجع فوق تعليق نفس القسم في
  // admin-technicians.service.ts. مسار مستقل بريفكس مختلف (`service-declarations`) عشان ميتصادمش
  // مع `:id` أدناه.
  @Get('service-declarations')
  @RequirePermission('technicians.approve')
  async listServiceDeclarations() {
    const items = await this.adminTechniciansService.listPendingServiceDeclarationsWithNames();
    return items.map(({ row, technicianCode, technicianFullName, serviceNameAr }) => ({
      ...toTechnicianServiceResponseDto(row, { includeTechnicianId: true }),
      technician_code: technicianCode,
      technician_full_name: technicianFullName,
      service_name_ar: serviceNameAr,
    }));
  }

  @Post('service-declarations/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async approveServiceDeclaration(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveTechnicianServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.adminTechniciansService.approveServiceDeclaration(admin.sub, id, dto, audit);
    return toTechnicianServiceResponseDto(row);
  }

  @Post('service-declarations/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async rejectServiceDeclaration(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTechnicianServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.adminTechniciansService.rejectServiceDeclaration(admin.sub, id, dto.reason, audit);
    return toTechnicianServiceResponseDto(row);
  }

  @Post('service-declarations/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async suspendServiceDeclaration(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTechnicianServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.adminTechniciansService.suspendServiceDeclaration(admin.sub, id, dto.reason, audit);
    return toTechnicianServiceResponseDto(row);
  }

  // طابور مراجعة تصريحات الفئة/التخصص الذاتية (ADR-0018 §8) — نفس نمط service-declarations
  // فوق بالحرف، بريفكس مختلف (`category-declarations`) لنفس سبب ميتصادمش مع `:id` تحت.
  @Get('category-declarations')
  @RequirePermission('technicians.approve')
  async listCategoryDeclarations() {
    const items = await this.technicianCategoriesService.listPendingCategoryDeclarationsWithNames();
    return items.map(({ row, technicianCode, technicianFullName, categoryNameAr }) => ({
      ...toTechnicianCategoryResponseDto(row, { includeTechnicianId: true }),
      technician_code: technicianCode,
      technician_full_name: technicianFullName,
      category_name_ar: categoryNameAr,
    }));
  }

  @Post('category-declarations/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async approveCategoryDeclaration(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.technicianCategoriesService.approveCategoryDeclaration(admin.sub, id, audit);
    return toTechnicianCategoryResponseDto(row);
  }

  @Post('category-declarations/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async rejectCategoryDeclaration(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTechnicianCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.technicianCategoriesService.rejectCategoryDeclaration(admin.sub, id, dto.reason, audit);
    return toTechnicianCategoryResponseDto(row);
  }

  @Post('category-declarations/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async suspendCategoryDeclaration(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTechnicianCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.technicianCategoriesService.suspendCategoryDeclaration(admin.sub, id, dto.reason, audit);
    return toTechnicianCategoryResponseDto(row);
  }

  // تعيين مباشر من الأدمن (§29) — كارت "التخصصات" في بروفايل الفني. بعكس category-declarations
  // فوق (موافقة/رفض طلب قائم من الفني)، الـ3 دول بيسمحوا للأدمن يعيّن/يشيل فئة لفني مباشرة من
  // غير ما ينتظر تصريح ذاتي. نفس نمط zones تحت بالحرف.
  @Get(':id/categories')
  async listCategories(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.technicianCategoriesService.listForTechnician(id);
    return rows.map((row) => toTechnicianCategoryResponseDto(row));
  }

  @Post(':id/categories')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async assignCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelfDeclareCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const row = await this.technicianCategoriesService.adminAssignCategory(admin.sub, id, dto.category_id, audit);
    return toTechnicianCategoryResponseDto(row);
  }

  @Delete(':id/categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.approve')
  async removeCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.technicianCategoriesService.adminRemoveCategory(admin.sub, id, categoryId, audit);
    return { category_id: categoryId, removed: true };
  }

  @Get(':id')
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const { profile, user, documents } = await this.adminTechniciansService.getDetail(id);
    const certificates = await this.certificatesService.listForTechnician(id);
    // docs/08 §35.10 — observability بحت (online/last_active_at)، منفصل تمامًا عن is_available/
    // is_on_duty. راجع TechnicianActivityService.
    const activity = await this.technicianActivityService.getActivityForUser(profile.userId);
    return toAdminTechnicianDetailResponseDto(profile, user, documents, certificates, this.storage, activity);
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

  // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — منفصلة عن current_level التشغيلي.
  @Patch(':id/pricing-tier')
  @RequirePermission('technicians.approve')
  async changePricingTier(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTechnicianPricingTierDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const { profile, user } = await this.adminTechniciansService.changePricingTier(admin.sub, id, dto, audit);
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
    return toCertificateResponseDto(certificate, this.storage);
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
