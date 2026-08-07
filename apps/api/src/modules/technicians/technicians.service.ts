import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianProfile } from './entities/technician-profile.entity';

@Injectable()
export class TechniciansService {
  constructor(@InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>) {}

  async findByUserId(userId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.TECH_001, 'حسابك غير معتمد بعد', HttpStatus.NOT_FOUND);
    }
    return profile;
  }
}
