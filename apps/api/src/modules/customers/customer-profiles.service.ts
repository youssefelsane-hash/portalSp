import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CustomerProfile } from './entities/customer-profile.entity';

@Injectable()
export class CustomerProfilesService {
  constructor(
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

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

  async findContactInfoByProfileIdOrThrow(profileId: string | null | undefined): Promise<{ name: string; phone: string }> {
    if (!profileId) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    const [contact] = await this.dataSource.query<Array<{ name: string; phone: string }>>(
      `SELECT u.full_name AS name, u.phone_number AS phone
       FROM customer_profiles cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.id = $1 AND cp.deleted_at IS NULL AND u.deleted_at IS NULL`,
      [profileId],
    );
    if (!contact) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return contact;
  }

  /**
   * فحص "عميل جديد" الحقيقي وقت الاستخدام — عمداً مش `customerProfile.totalOrdersCount`
   * (بَقّة حقيقية اتلقطت في مراجعة شاملة 2026-08-12: العمود ده بيتحدّث async عبر BullMQ job
   * بعد commit إنشاء الطلب، مش لحظيًا — نفس فئة البَقّة الموثّقة بالفعل في referrals/README.md
   * لـ`completed_orders_count`. الأثر: orders.service.ts وpromotions.service.ts كانوا بيستخدموا
   * العمود المؤجَّل ده كشرط أكواد الخصم "لعملاء جدد بس"، يعني لو عميل عمل أكتر من طلب بسرعة قبل
   * ما الـjob يشتغل، ممكن يتحسب "جديد" غلط أكتر من مرة). `COUNT(*)` مباشر هنا مضمون دقيق فورًا.
   */
  async isNewCustomer(customerProfileId: string): Promise<boolean> {
    const [{ count }] = await this.dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*) AS count FROM orders WHERE customer_id = $1',
      [customerProfileId],
    );
    return Number(count) === 0;
  }
}
