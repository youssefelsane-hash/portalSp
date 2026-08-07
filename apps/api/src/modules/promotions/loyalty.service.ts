import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { LoyaltyDirection, LoyaltySource, LoyaltyTransaction } from './entities/loyalty-transaction.entity';

@Injectable()
export class LoyaltyService {
  constructor(
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
    @InjectRepository(LoyaltyTransaction) private readonly transactions: Repository<LoyaltyTransaction>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getBalance(userId: string): Promise<number> {
    const profile = await this.customerProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile.loyaltyPointsBalance;
  }

  listTransactions(userId: string): Promise<LoyaltyTransaction[]> {
    return this.transactions.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** قفل ذرّي على صف بروفايل العميل يمنع أي سباق بين عمليتي earn/redeem متزامنتين لنفس المستخدم. */
  private async lockProfile(userId: string, manager: EntityManager): Promise<CustomerProfile> {
    const profile = await manager
      .createQueryBuilder(CustomerProfile, 'c')
      .setLock('pessimistic_write')
      .where('c.user_id = :userId', { userId })
      .getOne();
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  async earn(
    userId: string,
    points: number,
    source: LoyaltySource,
    referenceId: string | null = null,
    expiresAt: Date | null = null,
  ): Promise<LoyaltyTransaction> {
    if (points <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'عدد النقاط لازم يكون أكبر من صفر', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.lockProfile(userId, manager);
      const balanceAfter = profile.loyaltyPointsBalance + points;
      await manager.update(CustomerProfile, { id: profile.id }, { loyaltyPointsBalance: balanceAfter });
      return manager.save(
        manager.create(LoyaltyTransaction, {
          userId,
          pointsAmount: points,
          direction: LoyaltyDirection.EARN,
          source,
          referenceId,
          balanceAfter,
          expiresAt,
        }),
      );
    });
  }

  async redeem(userId: string, points: number, source: LoyaltySource, referenceId: string | null = null): Promise<LoyaltyTransaction> {
    if (points <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'عدد النقاط لازم يكون أكبر من صفر', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.lockProfile(userId, manager);
      if (profile.loyaltyPointsBalance < points) {
        throw new ApiException(ErrorCode.VAL_001, 'رصيد النقاط مش كافي', HttpStatus.BAD_REQUEST);
      }
      const balanceAfter = profile.loyaltyPointsBalance - points;
      await manager.update(CustomerProfile, { id: profile.id }, { loyaltyPointsBalance: balanceAfter });
      return manager.save(
        manager.create(LoyaltyTransaction, {
          userId,
          pointsAmount: -points,
          direction: LoyaltyDirection.REDEEM,
          source,
          referenceId,
          balanceAfter,
        }),
      );
    });
  }
}
