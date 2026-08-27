import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { assertFileSignatureMatches } from '../../common/storage/file-signature-validator';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toOrderResponseDto, toTechnicianOrderResponseDto } from './dto/order-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { toOrderItemResponseDto } from './dto/order-item-response.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CancelOrderAsTechnicianDto } from './dto/cancel-order-as-technician.dto';
import { CreateTechnicianRescheduleRequestDto } from './dto/create-technician-reschedule-request.dto';
import { ProposeQuoteItemsDto } from './dto/propose-quote-items.dto';
import { SubmitInitialQuoteDto } from './dto/submit-initial-quote.dto';
import { ReportFailedVisitDto } from './dto/report-failed-visit.dto';
import { ReportCashNotReceivedDto } from './dto/report-cash-not-received.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { toTeamMemberResponseDto } from './dto/team-member-response.dto';
import { RecruitTeamMemberDto } from './dto/recruit-team-member.dto';
import { toRecruitCandidateResponseDto } from './dto/recruit-candidate-response.dto';
import { BookingMode, Order } from './entities/order.entity';
import { OrderItemsService } from './order-items.service';
import { InspectionQuoteService } from './inspection-quote.service';
import { OrderMediaService } from './order-media.service';
import { CrewRole, OrderTeamService } from './order-team.service';
import { OrdersService } from './orders.service';
import { TechniciansService } from '../technicians/technicians.service';
import { PaymentsService } from '../payments/payments.service';
import { CatalogService } from '../catalog/catalog.service';
import { TECHNICIAN_CONTACT_VISIBLE_STATUSES } from './order-state-machine';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// دورة عمل الفني على الطلب اللي اتاخده فعلاً — accept/reject نفسهم في modules/matching (بيتعاملوا مع order_assignments)
@Controller('technician/orders')
@Roles(UserType.TECHNICIAN)
export class TechnicianOrderExecutionController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderMediaService: OrderMediaService,
    private readonly orderItemsService: OrderItemsService,
    private readonly inspectionQuoteService: InspectionQuoteService,
    private readonly orderTeamService: OrderTeamService,
    private readonly addressesService: AddressesService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly paymentsService: PaymentsService,
    private readonly catalogService: CatalogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // findByIdOrThrow من غير فحص ملكية عمداً — أي طلب بيوصل هنا أصلاً اتحقق إنه بتاع الفني الحالي
  // (findOwnedByTechnicianOrThrow/findActiveForTechnician/depart/arrive/... كلهم بيضمنوا كده)،
  // فالعنوان بتاعه مضمون الوصول ليه. بيتنادى بعد كل فعل تنفيذي عشان زرار "افتح الملاحة" في
  // apps/technician-app يفضل شغال طول دورة التنفيذ، مش بس أول تحميل للشاشة.
  private async toDto(order: Order, viewerProfileId?: string | null) {
    // بيانات العميل/الخدمة (docs/08 §56 بند 3) — بلاغ مالك: شاشة الفني كانت بتعرض أزرار التنفيذ
    // بلا اسم العميل ولا تليفونه ولا اسم الخدمة، فالفني مش عارف رايح لمين ولا يعمل إيه. بيانات
    // التواصل بتظهر بس بعد تأكيد حجز حقيقي — نفس TECHNICIAN_CONTACT_VISIBLE_STATUSES بالظبط
    // اللي العميل بيشوف بيها الفني، مرآة كاملة. مفيش استعلام أصلاً قبل الحالة دي.
    const contactVisible = TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(order.orderStatus);
    const [address, money, customerContact, serviceNameAr] = await Promise.all([
      this.addressesService.findByIdOrThrow(order.addressId),
      // docs/08 §60.2 (طلب مالك صريح) — الصورة المالية المفلترة بدل التفصيل الكامل. الفلترة في
      // الباك-إند مش في التطبيق: لو الأرقام خرجت على السلك، أي حد بتوكن فني يقراها من الـAPI
      // مهما كانت الواجهة بتخفيها.
      // ADR-0040 (docs/08 §64.ب): عضو الطاقم كان بيشوف وعاء القائد كله كأنه نصيبه هو.
      this.paymentsService.getTechnicianMoneyView(order, undefined, viewerProfileId),
      contactVisible ? this.customerProfilesService.findContactInfoOrThrow(order.customerId) : Promise.resolve(null),
      // بَقّة حقيقية (docs/08 §64.أ): كانت findServiceOrThrow() اللي بتفلتر is_active=true —
      // فأي طلب خدمته اتوقفت بعد إنشائه كان بيرمي 404 يفضّي شاشة الفني بالكامل ويمنع تنفيذ الشغل.
      this.catalogService.findServiceForDisplay(order.serviceId).then((service) => service?.nameAr ?? null),
    ]);
    return toTechnicianOrderResponseDto(
      toOrderResponseDto(order, address, null, {
        customerContact,
        serviceNameAr,
        isNewForTechnician: order.technicianViewedAt === null,
      }),
      money,
    );
  }

  /**
   * نسخة toDto بتحسب حقول تجنيد الفريق (docs/08 §31) — بس لمسارات تفاصيل الطلب الفردي
   * (getOne/team-assigned)، مش القوائم العادية ولا أفعال التنفيذ (زرار "افتح الملاحة" مش محتاج
   * الحقول دي، صفر استعلام إضافي غير ضروري في المسار الساخن ده).
   */
  private async toDtoWithTeamInfo(order: Order, viewerProfileId: string) {
    const base = await this.toDto(order, viewerProfileId);
    if (order.bookingMode !== BookingMode.TEAM) {
      return base;
    }
    if (order.technicianId === viewerProfileId) {
      // docs/08 §35، ADR-0021 §1 — crew_status موحّد (فني/مساعد منفصلين) بدل team_shortage/
      // team_members_needed القديمين (كانوا بيتجاهلوا required_assistants تمامًا).
      const crewStatus = await this.orderTeamService.getCrewComposition(order.id, order);
      return { ...base, crew_status: crewStatus };
    }
    if (order.technicianId) {
      const leader = await this.techniciansService.findContactInfoOrThrow(order.technicianId);
      return { ...base, team_leader_name: leader.name };
    }
    return base;
  }

  /**
   * رد أي فعل تنفيذي (docs/08 §70، بلاغ مالك) — بَقّة حقيقية: كل الأفعال (accept/depart/arrive/
   * start/complete/...) كانت بترجّع `toDto()` **من غير `crew_status`**، وتطبيق الفني بيحط الرد ده
   * مكان الطلب الحالي — فكارت "الطاقم ناقص" وأزرار ضم فني/مساعد كانوا **بيختفوا بعد أول فعل**
   * ويرجعوا بس لما الشاشة تعيد التحميل من `getOne()`. ده اللي المالك وصفه بـ«بيظهر أول ما الطلب
   * ييجي وبعدين بيختفي». الاستعلام الزيادة بيتعمل **بس لطلبات الفريق** (نفس تحفّظ الأداء الأصلي).
   */
  private async toDtoAfterAction(order: Order, userId: string) {
    if (order.bookingMode !== BookingMode.TEAM) {
      return this.toDto(order);
    }
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.toDtoWithTeamInfo(order, profile.id);
  }

  // مسار حرفي (`active`) لازم يتسجّل قبل `:id` — وإلا NestJS هيحاول يفسّرها كـ UUID ويرفضها
  // (ParseUUIDPipe) قبل ما توصل هنا خالص. كانت فجوة موثّقة صراحة في apps/technician-app/README.md:
  // مفيش endpoint يرجّع "الطلب النشط الحالي" من غير ما التطبيق يعرف الـ id مقدماً — يعني لو
  // التطبيق اتقفل في نص دورة التنفيذ ورجع اتفتح تاني، مفيش طريقة يسترجع الشاشة تلقائياً.
  @Get('active')
  async getActive(@CurrentUser() user: JwtPayload) {
    const order = await this.ordersService.findActiveForTechnician(user.sub);
    return order ? this.toDtoAfterAction(order, user.sub) : null;
  }

  // "الشغل المؤكّد قدامي" (docs/08 §165) — كانت فجوة حقيقية: طلبات مجدولة (ADR-0018: أي طلب غير
  // طوارئ) بتتأكّد تلقائيًا (autoConfirmScheduledOrder()) من غير أي شاشة في apps/technician-app
  // تعرضها للفني قبل ما يوم تنفيذها يوصل — الفني معندوش أي طريقة يشوف "إيه المؤكّد قدامي" غير
  // طلبات الطوارئ اللي محتاجة قبول/رفض صريح (GET .../available). مسار حرفي (`upcoming-confirmed`)
  // لازم يتسجّل قبل `:id` لنفس سبب `active` فوق بالظبط.
  @Get('upcoming-confirmed')
  async listUpcomingConfirmed(@CurrentUser() user: JwtPayload) {
    const orders = await this.ordersService.findUpcomingConfirmedForTechnician(user.sub);
    return Promise.all(orders.map((order) => this.toDto(order)));
  }

  // "شغل متأخر" (docs/08 §56 بند 4) — اتقبل، يومه عدّى، ولسه ما بدأش. كان بيختفي من كل الشاشات.
  // مسار حرفي لازم يتسجّل قبل :id لنفس سبب active/upcoming-confirmed فوق بالظبط.
  @Get('overdue')
  async listOverdue(@CurrentUser() user: JwtPayload) {
    const orders = await this.ordersService.findOverdueForTechnician(user.sub);
    return Promise.all(orders.map((order) => this.toDto(order)));
  }

  // "شغلي كعضو فريق" (docs/08 §31) — مسار حرفي لازم يتسجّل قبل :id لنفس سبب active/upcoming-confirmed فوق.
  @Get('team-assigned')
  async listTeamAssigned(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const orders = await this.ordersService.listTeamAssignedForTechnician(user.sub);
    return Promise.all(orders.map((order) => this.toDtoWithTeamInfo(order, profile.id)));
  }

  // نفس الفجوة القديمة (قراءة طلب واحد بالـ id) — كانت موثّقة صراحة، اتقفلت. بقى findVisibleForTechnician
  // بدل findOwnedByTechnicianOrThrow (docs/08 §31) — عضو فريق مُضاف يقدر يشوف تفاصيل الطلب دلوقتي كمان.
  @Get(':id')
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const order = await this.ordersService.findVisibleForTechnician(user.sub, id);
    // الرد بيتبني **قبل** التعليم عمدًا — الفني لازم يشوف "جديد" في نفس الفتحة اللي هو بيقراه
    // فيها، والفتحات اللي بعدها بس هي اللي تبقى "مقروء" (نفس سلوك أي inbox).
    const dto = await this.toDtoWithTeamInfo(order, profile.id);
    await this.ordersService.markViewedByTechnician(order, profile.id);
    return dto;
  }

  /** مرشّحين للتجنيد (docs/08 §31/§35) — القائد بس (listRecruitCandidates بتفحص الملكية داخلها).
   * `role` إجباري (technician/assistant) — أي دور محتاج يكمّله القائد دلوقتي. */
  @Get(':id/recruit-candidates')
  async listRecruitCandidates(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('role') role: CrewRole = 'technician',
  ) {
    const candidates = await this.orderTeamService.listRecruitCandidates(user.sub, id, role === 'assistant' ? 'assistant' : 'technician');
    return candidates.map(toRecruitCandidateResponseDto);
  }

  /** تجنيد (docs/08 §31/§35) — LIGHT بيتضاف فورًا، MEANINGFUL/HEAVY بيتعرضله فرصة اختيارية بدل تحميل صامت. */
  @Post(':id/recruit-candidates/:technicianId')
  @HttpCode(HttpStatus.OK)
  async recruitTeamMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('technicianId', ParseUUIDPipe) technicianId: string,
    @Body() dto: RecruitTeamMemberDto,
  ) {
    const outcome = await this.orderTeamService.recruitMember(user.sub, id, technicianId, dto.role === 'assistant' ? 'assistant' : 'technician', dto.role_label);
    if (outcome.status === 'offer_sent') {
      return { status: outcome.status, opportunity_id: outcome.opportunityId, capacity_tier: outcome.capacityTier };
    }
    const items = (await this.orderTeamService.listForOrder(id)).map(toTeamMemberResponseDto);
    return { status: outcome.status, items };
  }

  /** فرص تجنيد الفريق المفتوحة للفني الحالي (docs/08 §35) — منفصلة عن /work-opportunities العادية
   * (matching module) عشان أثر القبول مختلف جوهريًا (ينضم كعضو، مش يبقى قائد). */
  @Get('work-opportunities/crew')
  listCrewOpportunities(@CurrentUser() user: JwtPayload) {
    return this.orderTeamService.listCrewOpportunitiesForUser(user.sub);
  }

  @Post('work-opportunities/:opportunityId/accept-crew')
  @HttpCode(HttpStatus.OK)
  async acceptCrewOpportunity(@CurrentUser() user: JwtPayload, @Param('opportunityId', ParseUUIDPipe) opportunityId: string) {
    const items = await this.orderTeamService.acceptCrewOpportunity(user.sub, opportunityId);
    return { items: items.map(toTeamMemberResponseDto) };
  }

  @Post('work-opportunities/:opportunityId/decline-crew')
  @HttpCode(HttpStatus.OK)
  async declineCrewOpportunity(@CurrentUser() user: JwtPayload, @Param('opportunityId', ParseUUIDPipe) opportunityId: string) {
    await this.orderTeamService.declineCrewOpportunity(user.sub, opportunityId);
    return null;
  }

  // سياسة إلغاء الفني (docs/10) — استشاري بس، الواجهة بتستخدمه قبل ما تعرض زرار "إلغاء" أصلاً.
  // الفرض الحقيقي جوّه technicianCancel() بغض النظر عن الرد هنا.
  @Get(':id/cancellation-policy')
  async getCancellationPolicy(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getTechnicianCancellationPolicy(user.sub, id);
  }

  @Get(':id/reschedule-requests')
  async listRescheduleRequests(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.listRescheduleRequestsForTechnician(user.sub, id);
  }

  @Post(':id/reschedule-requests')
  async requestReschedule(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTechnicianRescheduleRequestDto,
  ) {
    return this.ordersService.requestRescheduleByTechnician(user.sub, id, dto);
  }

  // كانت فجوة موثّقة صراحة: الفني معندوش أي طريقة يلغي طلب اتقبله بنفسه لو حصل ظرف طارئ —
  // اتقفلت، وبعدين اتحوّلت لسياسة كاملة قابلة للإعداد (نافذة زمنية، صلاحيات فريق، إعادة مطابقة
  // حسب booking_mode) بدل القرار البسيط القديم — تفاصيل كاملة في OrdersService.technicianCancel().
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderAsTechnicianDto,
  ) {
    return this.toDtoAfterAction(await this.ordersService.technicianCancel(user.sub, id, dto), user.sub);
  }

  @Post(':id/depart')
  async depart(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDtoAfterAction(await this.ordersService.depart(user.sub, id), user.sub);
  }

  @Post(':id/arrive')
  async arrive(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDtoAfterAction(await this.ordersService.arrive(user.sub, id), user.sub);
  }

  @Post(':id/start')
  async start(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDtoAfterAction(await this.ordersService.start(user.sub, id), user.sub);
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDtoAfterAction(await this.ordersService.complete(user.sub, id), user.sub);
  }

  // زيارة فاشلة/عدم حضور (docs/08 §22 بند 3+6) — الفني بيوقف بدل ما يكمّل شغل غير مصرّح أو يقفل
  // الطلب "مكتمل" كاذبة، ويوديه لمراجعة أدمن حقيقية.
  @Post(':id/report-failed-visit')
  async reportFailedVisit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportFailedVisitDto,
  ) {
    return this.toDtoAfterAction(await this.ordersService.reportFailedVisit(user, id, dto), user.sub);
  }

  // "لم أستلم" الكاش (docs/08 §22 بند 13-14) — مسار الفني للتنازع، مش قرار نهائي فوري (بيودّي
  // لمراجعة أدمن حقيقية عبر الشكوى + resolveCashHandoverDispute).
  @Post(':id/cash-not-received')
  async cashNotReceived(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportCashNotReceivedDto,
  ) {
    return this.toDtoAfterAction(await this.ordersService.reportCashNotReceived(user, id, dto), user.sub);
  }

  @Post(':id/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async uploadMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    assertFileSignatureMatches(file.buffer, file.mimetype, ALLOWED_MIME_TYPES);

    const media = await this.orderMediaService.upload(user.sub, id, dto.media_type, dto.caption, file);
    return toOrderMediaResponseDto(media, this.storage);
  }

  @Get(':id/media')
  async listMedia(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const media = await this.orderMediaService.listForTechnician(user.sub, id);
    return Promise.all(media.map((m) => toOrderMediaResponseDto(m, this.storage)));
  }

  // كانت فجوة موثّقة صراحة (S7): مفيش مسار لاقتراح قطع غيار/أجرة إضافية بموافقة العميل —
  // تفاصيل كاملة في order-items.service.ts.
  @Post(':id/quote-items')
  async proposeQuoteItems(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposeQuoteItemsDto,
  ) {
    const { order, items } = await this.orderItemsService.propose(user.sub, id, dto.items);
    return { order: await this.toDtoAfterAction(order, user.sub), items: items.map(toOrderItemResponseDto) };
  }

  @Get(':id/quote-items')
  async listQuoteItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const items = await this.orderItemsService.listForTechnician(user.sub, id);
    return items.map(toOrderItemResponseDto);
  }

  // معاينة-ثم-سعر (ADR-0044، docs/08 §73 بند 1) — الفني بيحدد السعر بعد ما وصل وعاين المكان
  // فعليًا لخدمة pricing_model=inspection_then_quote. مختلفة عمداً عن quote-items فوق (راجع
  // inspection-quote.service.ts).
  @Post(':id/submit-initial-quote')
  async submitInitialQuote(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitInitialQuoteDto,
  ) {
    const order = await this.inspectionQuoteService.submitInitialQuote(user.sub, id, dto.quoted_amount_cents, dto.note);
    return this.toDtoAfterAction(order, user.sub);
  }

  // توزيع أدوار الفريق داخل الطلب الواحد (docs/08 §5) — فقط لقائد الطلب (orders.technician_id)
  // على طلبات "اعتماد" (فريق)، وبس لأعضاء من نفس الشركة/الفريق. تفاصيل كاملة في orders/README.md.
  @Post(':id/team-members')
  async addTeamMember(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTeamMemberDto) {
    await this.orderTeamService.addMember(user.sub, id, dto);
    return (await this.orderTeamService.listForOrder(id)).map(toTeamMemberResponseDto);
  }

  @Get(':id/team-members')
  async listTeamMembers(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    // إصلاح أمني (مراجعة booking flow الشاملة 2026-08-12) — نفس فئة بَقّة listMedia بالظبط:
    // كانت بتنادي listForOrder(id) (عامة عمداً، بلا تحقق ملكية) من غير أي فحص قبلها، فأي فني
    // يقدر يشوف أعضاء فريق طلب مش بتاعه. بقى findVisibleForTechnician (docs/08 §31) بدل
    // findOwnedByTechnicianOrThrow — عضو الفريق المُضاف يقدر يشوف زمايله دلوقتي كمان، مش القائد بس.
    await this.ordersService.findVisibleForTechnician(user.sub, id);
    return (await this.orderTeamService.listForOrder(id)).map(toTeamMemberResponseDto);
  }

  @Delete(':id/team-members/:memberId')
  @HttpCode(HttpStatus.OK)
  async removeTeamMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    await this.orderTeamService.removeMember(user.sub, id, memberId);
    return null;
  }
}
