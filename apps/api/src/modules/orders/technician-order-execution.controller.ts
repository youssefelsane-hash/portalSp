import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { assertFileSignatureMatches } from '../../common/storage/file-signature-validator';
import { AddressesService } from '../customers/addresses.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { toOrderItemResponseDto } from './dto/order-item-response.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CancelOrderAsTechnicianDto } from './dto/cancel-order-as-technician.dto';
import { ProposeQuoteItemsDto } from './dto/propose-quote-items.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { toTeamMemberResponseDto } from './dto/team-member-response.dto';
import { Order } from './entities/order.entity';
import { OrderItemsService } from './order-items.service';
import { OrderMediaService } from './order-media.service';
import { OrderTeamService } from './order-team.service';
import { OrdersService } from './orders.service';

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
    private readonly orderTeamService: OrderTeamService,
    private readonly addressesService: AddressesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // findByIdOrThrow من غير فحص ملكية عمداً — أي طلب بيوصل هنا أصلاً اتحقق إنه بتاع الفني الحالي
  // (findOwnedByTechnicianOrThrow/findActiveForTechnician/depart/arrive/... كلهم بيضمنوا كده)،
  // فالعنوان بتاعه مضمون الوصول ليه. بيتنادى بعد كل فعل تنفيذي عشان زرار "افتح الملاحة" في
  // apps/technician-app يفضل شغال طول دورة التنفيذ، مش بس أول تحميل للشاشة.
  private async toDto(order: Order) {
    const address = await this.addressesService.findByIdOrThrow(order.addressId);
    return toOrderResponseDto(order, address);
  }

  // مسار حرفي (`active`) لازم يتسجّل قبل `:id` — وإلا NestJS هيحاول يفسّرها كـ UUID ويرفضها
  // (ParseUUIDPipe) قبل ما توصل هنا خالص. كانت فجوة موثّقة صراحة في apps/technician-app/README.md:
  // مفيش endpoint يرجّع "الطلب النشط الحالي" من غير ما التطبيق يعرف الـ id مقدماً — يعني لو
  // التطبيق اتقفل في نص دورة التنفيذ ورجع اتفتح تاني، مفيش طريقة يسترجع الشاشة تلقائياً.
  @Get('active')
  async getActive(@CurrentUser() user: JwtPayload) {
    const order = await this.ordersService.findActiveForTechnician(user.sub);
    return order ? this.toDto(order) : null;
  }

  // نفس الفجوة القديمة (قراءة طلب واحد بالـ id) — كانت موثّقة صراحة، اتقفلت.
  @Get(':id')
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.ordersService.findOwnedByTechnicianOrThrow(user.sub, id));
  }

  // سياسة إلغاء الفني (docs/10) — استشاري بس، الواجهة بتستخدمه قبل ما تعرض زرار "إلغاء" أصلاً.
  // الفرض الحقيقي جوّه technicianCancel() بغض النظر عن الرد هنا.
  @Get(':id/cancellation-policy')
  async getCancellationPolicy(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getTechnicianCancellationPolicy(user.sub, id);
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
    return this.toDto(await this.ordersService.technicianCancel(user.sub, id, dto));
  }

  @Post(':id/depart')
  async depart(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.ordersService.depart(user.sub, id));
  }

  @Post(':id/arrive')
  async arrive(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.ordersService.arrive(user.sub, id));
  }

  @Post(':id/start')
  async start(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.ordersService.start(user.sub, id));
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.ordersService.complete(user.sub, id));
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
    return { order: await this.toDto(order), items: items.map(toOrderItemResponseDto) };
  }

  @Get(':id/quote-items')
  async listQuoteItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const items = await this.orderItemsService.listForTechnician(user.sub, id);
    return items.map(toOrderItemResponseDto);
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
    // يقدر يشوف أعضاء فريق طلب مش بتاعه. findOwnedByTechnicianOrThrow نفس الفحص اللي getOne()
    // بتستخدمه في نفس الـcontroller ده.
    await this.ordersService.findOwnedByTechnicianOrThrow(user.sub, id);
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
