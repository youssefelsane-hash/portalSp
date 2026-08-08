import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class TechniciansService {
  constructor(@InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>) {}

  async findByUserIdOrThrow(userId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.TECH_001, 'حسابك غير معتمد بعد', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  // بَقّة حقيقية اتلقطت واتصلحت: TypeORM بيسقط أي خاصية قيمتها JS null من findOne({where})
  // بدل ما يولّد "id IS NULL" — يعني findOne({where:{id: null}}) كان بيرجّع صف عشوائي (أول
  // صف بترتيب فحص الفهرس، مش الأقدم إنشاءً) بدل ما يرجع فاضي. الفحص الصريح ده بيمنع أي استدعاء
  // بقيمة null/undefined (حتى لو TypeScript مقتنع إنها string بسبب `!` غير موثوق) من يوصل
  // للـ query أصلاً. اتلقطت وقت اختبار حي لدفع طلب اتعمله بـ raw SQL بتقنية "أعمى" (technician_id
  // فاضي) — العمولة اترحّلت فعلياً لمحفظة فني عشوائي غير مرتبط بالطلب. راجع payments/README.md.
  async findByProfileIdOrThrow(profileId: string | null | undefined): Promise<TechnicianProfile> {
    if (!profileId) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    const profile = await this.technicianProfiles.findOne({ where: { id: profileId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto): Promise<TechnicianProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (dto.is_available !== undefined) profile.isAvailable = dto.is_available;
    if (dto.is_on_duty !== undefined) profile.isOnDuty = dto.is_on_duty;
    await this.technicianProfiles.save(profile);
    return profile;
  }

  async updateLocation(userId: string, dto: UpdateLocationDto): Promise<void> {
    const profile = await this.findByUserIdOrThrow(userId);
    profile.currentLocation = { type: 'Point', coordinates: [dto.longitude, dto.latitude] };
    await this.technicianProfiles.update(profile.id, {
      currentLocation: profile.currentLocation,
      currentLocationUpdatedAt: new Date(),
    });
  }
}
