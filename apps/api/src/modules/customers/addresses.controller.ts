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
    const addresses = await this.addressesService.findAllForUser(user.sub);
    return addresses.map(toAddressResponseDto);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAddressDto) {
    return toAddressResponseDto(await this.addressesService.create(user.sub, dto));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return toAddressResponseDto(await this.addressesService.update(user.sub, id, dto));
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.addressesService.remove(user.sub, id);
    return null;
  }
}
