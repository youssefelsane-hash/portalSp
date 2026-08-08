import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { GeoService } from '../geo/geo.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { Address } from './entities/address.entity';
import { CustomerProfile } from './entities/customer-profile.entity';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
    private readonly geoService: GeoService,
  ) {}

  findAllForUser(userId: string): Promise<Address[]> {
    return this.addresses.find({ where: { userId }, order: { isDefault: 'DESC', createdAt: 'DESC' } });
  }

  async findOwnedOrThrow(userId: string, addressId: string): Promise<Address> {
    const address = await this.addresses.findOne({ where: { id: addressId, userId } });
    if (!address) {
      throw new ApiException(ErrorCode.VAL_001, 'العنوان غير موجود', HttpStatus.NOT_FOUND);
    }
    return address;
  }

  /**
   * من غير فحص ملكية — للفني اللي معيّن على طلب معيّن (مش صاحب العنوان نفسه)، عشان يشوف
   * إحداثيات الوصول/الملاحة. الاستدعاء الآمن هنا معتمد على إن الـ caller أصلاً تحقق من إن
   * الفني معيّن على الطلب ده (نفس حدود الثقة اللي findOwnedByTechnicianOrThrow بيضمنها في
   * orders.service.ts) — مش endpoint عام يقدر أي حد يجيب بيه أي عنوان بس الـ id.
   */
  async findByIdOrThrow(addressId: string): Promise<Address> {
    const address = await this.addresses.findOne({ where: { id: addressId } });
    if (!address) {
      throw new ApiException(ErrorCode.VAL_001, 'العنوان غير موجود', HttpStatus.NOT_FOUND);
    }
    return address;
  }

  async create(userId: string, dto: CreateAddressDto): Promise<Address> {
    // التغطية: الخدمة متاحة بس في المناطق اللي فعلاً مُطلقة — docs/01-master-plan.md §6 (S2)
    const isLaunched = await this.geoService.isAreaLaunched(dto.area_id);
    if (!isLaunched) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    if (dto.is_default) {
      await this.addresses.update({ userId }, { isDefault: false });
    }

    const address = this.addresses.create({
      userId,
      label: dto.label ?? null,
      cityId: dto.city_id,
      areaId: dto.area_id,
      streetName: dto.street_name,
      buildingNumber: dto.building_number ?? null,
      floorNumber: dto.floor_number ?? null,
      apartmentNumber: dto.apartment_number ?? null,
      landmark: dto.landmark ?? null,
      location: { type: 'Point', coordinates: [dto.longitude, dto.latitude] },
      contactName: dto.contact_name ?? null,
      contactPhone: dto.contact_phone ?? null,
      deliveryNotes: dto.delivery_notes ?? null,
      isDefault: dto.is_default ?? false,
      isVerified: false,
    });
    await this.addresses.save(address);

    if (address.isDefault) {
      await this.customerProfiles.update({ userId }, { defaultAddressId: address.id });
    }

    return address;
  }

  async update(userId: string, addressId: string, dto: UpdateAddressDto): Promise<Address> {
    const address = await this.findOwnedOrThrow(userId, addressId);

    if (dto.area_id && dto.area_id !== address.areaId) {
      const isLaunched = await this.geoService.isAreaLaunched(dto.area_id);
      if (!isLaunched) {
        throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
      }
      address.areaId = dto.area_id;
    }

    if (dto.city_id !== undefined) address.cityId = dto.city_id;
    if (dto.label !== undefined) address.label = dto.label;
    if (dto.street_name !== undefined) address.streetName = dto.street_name;
    if (dto.building_number !== undefined) address.buildingNumber = dto.building_number;
    if (dto.floor_number !== undefined) address.floorNumber = dto.floor_number;
    if (dto.apartment_number !== undefined) address.apartmentNumber = dto.apartment_number;
    if (dto.landmark !== undefined) address.landmark = dto.landmark;
    if (dto.contact_name !== undefined) address.contactName = dto.contact_name;
    if (dto.contact_phone !== undefined) address.contactPhone = dto.contact_phone;
    if (dto.delivery_notes !== undefined) address.deliveryNotes = dto.delivery_notes;
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      address.location = { type: 'Point', coordinates: [dto.longitude, dto.latitude] };
    }

    if (dto.is_default) {
      await this.addresses.update({ userId }, { isDefault: false });
      address.isDefault = true;
      await this.customerProfiles.update({ userId }, { defaultAddressId: address.id });
    }

    await this.addresses.save(address);
    return address;
  }

  async remove(userId: string, addressId: string): Promise<void> {
    await this.findOwnedOrThrow(userId, addressId);
    await this.addresses.softDelete({ id: addressId, userId });
  }
}
