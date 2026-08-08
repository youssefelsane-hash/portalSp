import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CustomerProfile } from './entities/customer-profile.entity';

@Injectable()
export class CustomerProfilesService {
  constructor(@InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>) {}

  async findByUserIdOrThrow(userId: string): Promise<CustomerProfile> {
    const profile = await this.customerProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  // نفس حماية findByProfileIdOrThrow في technicians.service.ts بالظبط — راجع التعليق هناك
  // للتفاصيل الكاملة عن بَقّة TypeORM (findOne({where:{id: null}}) بيرجّع صف عشوائي مش فاضي).
  async findByProfileIdOrThrow(profileId: string | null | undefined): Promise<CustomerProfile> {
    if (!profileId) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    const profile = await this.customerProfiles.findOne({ where: { id: profileId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }
}
