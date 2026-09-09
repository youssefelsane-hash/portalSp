import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { toAddressResponseDto } from './dto/address-response.dto';

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
