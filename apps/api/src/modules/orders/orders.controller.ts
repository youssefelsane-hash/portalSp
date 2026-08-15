import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { AddressesService } from '../customers/addresses.service';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ApproveQuoteItemsDto } from './dto/approve-quote-items.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RequestRematchDto } from './dto/request-rematch.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { toOrderItemResponseDto } from './dto/order-item-response.dto';
import { toOrderMediaResponseDto } from './dto/order-media-response.dto';
import { toOrderResponseDto } from './dto/order-response.dto';
import { toTeamMemberResponseDto } from './dto/team-member-response.dto';
import { TECHNICIAN_CONTACT_VISIBLE_STATUSES } from './order-state-machine';
import { OrderItemsService } from './order-items.service';
import { OrderMediaService } from './order-media.service';
import { OrderTeamService } from './order-team.service';
import { OrdersService } from './orders.service';
import { TechniciansService } from '../technicians/technicians.service';

@Controller('orders')
@Roles(UserType.CUSTOMER)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderItemsService: OrderItemsService,
    private readonly orderTeamService: OrderTeamService,
    private readonly orderMediaService: OrderMediaService,
    private readonly addressesService: AddressesService,
    private readonly techniciansService: TechniciansService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const orders = await this.ordersService.findAllForCustomerUser(user.sub);
    return orders.map((order) => toOrderResponseDto(order));
  }

  @Get(':id')
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    // الملكية اتفحصت هنا (findOneOwnedOrThrow) — أي بيانات بعد السطر ده مضمون إنها لعميل صاحب
    // الطلب فعلاً، بما فيها تليفون الفني (docs/08 §22 بند 1، حماية IDOR).
    const order = await this.ordersService.findOneOwnedOrThrow(user.sub, id);
    // العنوان بتاع العميل نفسه — findOwnedOrThrow بيتحقق من الملكية برضه (دفاع مزدوج رخيص)
    const address = await this.addressesService.findOwnedOrThrow(user.sub, order.addressId);
    // تليفون الفني بيظهر بس بعد تأكيد حجيز حقيقي (الفني وافق فعليًا) — قبل كده صفر استعلام حتى
    // (order.technicianId ممكن يبقى null أصلاً في الحالات المبكرة).
    const technicianContact =
      order.technicianId && TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(order.orderStatus)
        ? await this.techniciansService.findContactInfoOrThrow(order.technicianId)
        : null;
    return toOrderResponseDto(order, address, technicianContact);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return toOrderResponseDto(await this.ordersService.create(user.sub, dto));
  }

  // معاينة السعر الكامل قبل التأكيد (docs/08 §1/§2) — read-only، نفس منطق create() بالحرف.
  @Post('preview')
  async preview(@CurrentUser() user: JwtPayload, @Body() dto: PreviewOrderDto) {
    return this.ordersService.previewPrice(user.sub, dto);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return toOrderResponseDto(await this.ordersService.cancel(user.sub, id, dto));
  }

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — تأكيد العميل بس، مايسوّيش الطلب لوحده.
  @Post(':id/confirm-cash-handover')
  async confirmCashHandover(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toOrderResponseDto(await this.ordersService.confirmCashHandover(user.sub, id));
  }

  // إعادة جدولة (docs/08 §22 بند 9-12) — بس قبل ما الفني يبدأ يتحرّك فعليًا، ونفس الفني المعيّن.
  @Post(':id/reschedule')
  async reschedule(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleOrderDto,
  ) {
    return toOrderResponseDto(await this.ordersService.reschedule(user.sub, id, dto));
  }

  // سياسة إلغاء الفني (docs/10) — العميل بيستخدمها لما طلبه يبقى awaiting_technician_reselection
  // (فني لغى طلب كان العميل مختاره بنفسه) عشان يختار فني بديل بعينه أو يسيب المطابقة التلقائية.
  @Post(':id/request-rematch')
  async requestRematch(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestRematchDto,
  ) {
    return toOrderResponseDto(await this.ordersService.requestRematch(user.sub, id, dto));
  }

  // كانت فجوة موثّقة صراحة (S7): مسار عرض السعر أثناء الشغل — الفني يقترح، العميل يوافق/يرفض.
  @Get(':id/quote-items')
  async listQuoteItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const items = await this.orderItemsService.listForCustomer(user.sub, id);
    return items.map(toOrderItemResponseDto);
  }

  @Post(':id/quote-items/approve')
  async approveQuoteItems(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveQuoteItemsDto,
  ) {
    const { order, items } = await this.orderItemsService.approve(user.sub, id, dto.payment_choice ?? 'electronic');
    return { order: toOrderResponseDto(order), items: items.map(toOrderItemResponseDto) };
  }

  @Post(':id/quote-items/decline')
  async declineQuoteItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const { order } = await this.orderItemsService.decline(user.sub, id);
    return toOrderResponseDto(order);
  }

  // كانت فجوة موثّقة صراحة (docs/08 §9) — تقييم متقدم بيدعم ربط صور "بعد التنفيذ" الموجودة
  // بالفعل (after_photo_media_ids)، بس مفيش endpoint للعميل يشوف بيها الصور دي أصلاً قبل
  // ما يختار. GET .../media كان موجود للأدمن وللفني بس، مش للعميل صاحب الطلب.
  @Get(':id/media')
  async listMedia(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.ordersService.findOneOwnedOrThrow(user.sub, id);
    const media = await this.orderMediaService.listForOrder(id);
    return Promise.all(media.map((m) => toOrderMediaResponseDto(m, this.storage)));
  }

  // توزيع أدوار الفريق (docs/08 §5) — العميل يشوف مين هيشتغل معاه فعليًا في طلب "اعتماد" (فريق).
  @Get(':id/team-members')
  async listTeamMembers(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.ordersService.findOneOwnedOrThrow(user.sub, id);
    return (await this.orderTeamService.listForOrder(id)).map(toTeamMemberResponseDto);
  }
}
