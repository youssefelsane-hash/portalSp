import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { DomesticWorkerBooking, DomesticWorkerBookingStatus } from './entities/domestic-worker-booking.entity';
import { DomesticWorkerEarningApproval, DomesticWorkerEarningApprovalStatus } from './entities/domestic-worker-earning-approval.entity';

/**
 * طابور موافقة أرباح العمالة المنزلية. كل قرار يقفل الحجز ثم صف الاستحقاق، ويجمع الحالة والقيد
 * المالي في transaction واحدة. هذا هو المسار الوحيد الذي يحول pending إلى رصيد قابل للصرف.
 */
@Injectable()
export class DomesticWorkerEarningApprovalsService {
  constructor(
    @InjectRepository(DomesticWorkerEarningApproval) private readonly approvals: Repository<DomesticWorkerEarningApproval>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly auditLog: AuditLogService,
  ) {}

  listForAdmin(status?: DomesticWorkerEarningApprovalStatus): Promise<DomesticWorkerEarningApproval[]> {
    return this.approvals.find({
      where: status ? { status } : {},
      relations: { booking: true, workerUser: true, reviewedByUser: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** Every terminal decision locks booking first, then approval. Cancellation uses the same order. */
  private async lockDecisionRows(
    manager: EntityManager,
    id: string,
  ): Promise<{ booking: DomesticWorkerBooking; approval: DomesticWorkerEarningApproval }> {
    const snapshot = await manager.getRepository(DomesticWorkerEarningApproval).findOne({
      select: { id: true, bookingId: true },
      where: { id },
    });
    if (!snapshot) {
      throw new ApiException(ErrorCode.VAL_001, 'طلب استحقاق غير موجود', HttpStatus.NOT_FOUND);
    }

    const booking = await manager
      .createQueryBuilder(DomesticWorkerBooking, 'booking')
      .setLock('pessimistic_write')
      .where('booking.id = :bookingId', { bookingId: snapshot.bookingId })
      .getOne();
    const approval = await manager
      .createQueryBuilder(DomesticWorkerEarningApproval, 'approval')
      .setLock('pessimistic_write')
      .where('approval.id = :id', { id })
      .getOne();
    if (!booking || !approval) {
      throw new ApiException(ErrorCode.VAL_001, 'طلب الاستحقاق أو الحجز غير موجود', HttpStatus.NOT_FOUND);
    }
    return { booking, approval };
  }

  async approve(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<DomesticWorkerEarningApproval> {
    const result = await this.dataSource.transaction(async (manager) => {
      const { booking, approval } = await this.lockDecisionRows(manager, id);
      if (approval.status !== DomesticWorkerEarningApprovalStatus.PENDING) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش توافق على استحقاق في حالة ${approval.status}`,
          HttpStatus.CONFLICT,
        );
      }
      if (booking.status === DomesticWorkerBookingStatus.CANCELLED) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز ملغي والاستحقاق غير صالح للموافقة', HttpStatus.CONFLICT);
      }

      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
      const workerWallet = await this.walletsService.getOrCreateWallet(
        approval.workerUserId,
        WalletOwnerType.DOMESTIC_WORKER,
        manager,
      );
      await this.walletsService.doubleEntry(
        {
          fromWalletId: platformWallet.id,
          toWalletId: workerWallet.id,
          amountCents: approval.amountCents,
          transactionType: WalletTxType.ORDER_EARNING,
          referenceType: 'domestic_worker_earning_approval',
          referenceId: approval.id,
          descriptionAr: 'أرباح خدمة منزلية معتمدة من الإدارة',
          // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود — نفس السبب في settleAndComplete/chargeCustomerAndCreatePendingEarning.
          allowNegativeBalance: true,
        },
        manager,
      );

      approval.status = DomesticWorkerEarningApprovalStatus.APPROVED;
      approval.reviewedByUserId = adminUserId;
      approval.reviewedAt = new Date();
      await manager.save(approval);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'domestic_worker_earning.approved',
          entityType: 'domestic_worker_earning_approval',
          entityId: approval.id,
          oldValues: { status: DomesticWorkerEarningApprovalStatus.PENDING },
          newValues: { status: approval.status, amount_cents: approval.amountCents },
          meta,
        },
        manager,
      );
      return approval;
    });
    return result;
  }

  async reject(adminUserId: string, id: string, reason: string, meta?: AuditActorMeta): Promise<DomesticWorkerEarningApproval> {
    const approval = await this.dataSource.transaction(async (manager) => {
      const { approval: lockedApproval } = await this.lockDecisionRows(manager, id);
      if (lockedApproval.status !== DomesticWorkerEarningApprovalStatus.PENDING) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش ترفض استحقاق في حالة ${lockedApproval.status}`,
          HttpStatus.CONFLICT,
        );
      }

      lockedApproval.status = DomesticWorkerEarningApprovalStatus.REJECTED;
      lockedApproval.rejectionReason = reason;
      lockedApproval.reviewedByUserId = adminUserId;
      lockedApproval.reviewedAt = new Date();
      await manager.save(lockedApproval);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'domestic_worker_earning.rejected',
          entityType: 'domestic_worker_earning_approval',
          entityId: lockedApproval.id,
          oldValues: { status: DomesticWorkerEarningApprovalStatus.PENDING },
          newValues: { status: lockedApproval.status, reason },
          meta,
        },
        manager,
      );
      return lockedApproval;
    });
    return approval;
  }
}
