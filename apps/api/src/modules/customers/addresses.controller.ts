import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { toAddressResponseDto } from './dto/address-response.dto';

/**
 * **العناوين مقصورة على دور العميل** (ADR-0110).
 *
 * الحارس ده كان **ناقص**، وهو السبب المكانيكي لبلاغ المالك: «الصنايعي بيدخل تطبيق العميل بنفس
 * رقمه ويعدّي كأن الحساب موجود، لكن أول ما يطلب أي خدمة بيتصدّ». `/orders` كانت عليها
 * `@Roles(CUSTOMER)` وهنا مفيش، فالفني كان بيضيف عنوان بنجاح وبعدين يتصدّم في الحجز — **نصّ
 * شغّال**، وهو أسوأ من المقفول لأنه بيخلي المستخدم يفتكر إن حسابه سليم.
 *
 * **مش بيمنع الفني من إنه يبقى عميل**: الحارس بيقرا **الدور النشط** في الجلسة، فالفني الداخل من
 * تطبيق العميل دوره النشط `customer` وبيعدّي عادي. اللي بيمنعه هو استخدام **جلسة الفني** على
 * مسار عميل — وده هو المطلوب بالظبط.
 *
 * الجاران اللي بلا `@Roles` (`notifications`, `me/referrals`, `loyalty`) **مقصود** إنهم كده
 * وموثّق في كل واحد فيهم: خصائص شخصية بحتة مقيّدة بـ`user_id` ومحتاجة تشتغل للدورين. العناوين
 * مش كده — بيتربطوا بـ`orders.address_id` وهي علاقة عميل صِرفة.
 *
 * لوحة الأدمن **مابتتأثرش**: بتقرا عناوين العميل من `/admin/customers/:userId/addresses`
 * (`AdminCustomersController`)، مسار تاني خالص عليه `@Roles(ADMIN)`.
 */
@Roles(UserType.CUSTOMER)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const [addresses, activeAddressIds] = await Promise.all([
      this.addressesService.findAllForUser(user.sub),
      this.addressesService.findAddressIdsWithActiveOrders(user.sub),
    ]);
    return Promise.all(
      addresses.map(async (address) =>
        toAddressResponseDto(
          address,
          activeAddressIds.has(address.id),
          await this.addressesService.resolveServiceZoneId(address),
        ),
      ),
    );
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAddressDto) {
    const address = await this.addressesService.create(user.sub, dto);
    return toAddressResponseDto(address, false, await this.addressesService.resolveServiceZoneId(address));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const updated = await this.addressesService.update(user.sub, id, dto);
    return toAddressResponseDto(
      updated,
      await this.addressesService.hasActiveOrder(updated.id),
      await this.addressesService.resolveServiceZoneId(updated),
    );
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.addressesService.remove(user.sub, id);
    return null;
  }
}
