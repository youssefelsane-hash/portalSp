import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { DomesticWorkerEarningApproval, DomesticWorkerEarningApprovalStatus } from './entities/domestic-worker-earning-approval.entity';

/**
 * طابور موافقة أرباح العمالة المنزلية (docs/08 §25.1، قرار مالك صريح 2026-08-15) — نفس نمط
 * PayoutsService.adminApprove/adminReject بالحرف: فحص حالة صريح (`pending` بس) يمنع موافقة/رفض
 * مزدوج، `reviewed_by_user_id`/`reviewed_at` على الصف نفسه + AuditLogService، والمسار الوحيد اللي
 * بيحوّل الاستحقاق لرصيد قابل للصرف هو `approve()` هنا — صفر endpoint تاني يقدر يعمل نفس الحاجة.
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
      order: { createdAt: 'DESC' },
    });
  }

  private async findOrThrow(id: string, repo?: Repository<DomesticWorkerEarningApproval>): Promise<DomesticWorkerEarningApproval> {
    const approval = await (repo ?? this.approvals).findOne({ where: { id } });
    if (!approval) {
      throw new ApiException(ErrorCode.VAL_001, 'طلب استحقاق غير موجود', HttpStatus.NOT_FOUND);
    }
    return approval;
  }

  async approve(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<DomesticWorkerEarningApproval> {
    const result = await this.dataSource.transaction(async (manager) => {
      const approval = await this.findOrThrow(id, manager.getRepository(DomesticWorkerEarningApproval));
      if (approval.status !== DomesticWorkerEarningApprovalStatus.PENDING) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش توافق على استحقاق في حالة ${approval.status}`,
          HttpStatus.CONFLICT,
        );
      }

      const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
      const workerWallet = await this.walletsService.getOrCreateWallet(approval.workerUserId, WalletOwnerType.DOMESTIC_WORKER);
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
      return approval;
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'domestic_worker_earning.approved',
      entityType: 'domestic_worker_earning_approval',
      entityId: result.id,
      oldValues: { status: DomesticWorkerEarningApprovalStatus.PENDING },
      newValues: { status: result.status, amount_cents: result.amountCents },
      meta,
    });
    return result;
  }

  async reject(adminUserId: string, id: string, reason: string, meta?: AuditActorMeta): Promise<DomesticWorkerEarningApproval> {
    const approval = await this.findOrThrow(id);
    if (approval.status !== DomesticWorkerEarningApprovalStatus.PENDING) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `مينفعش ترفض استحقاق في حالة ${approval.status}`,
        HttpStatus.CONFLICT,
      );
    }

    approval.status = DomesticWorkerEarningApprovalStatus.REJECTED;
    approval.rejectionReason = reason;
    approval.reviewedByUserId = adminUserId;
    approval.reviewedAt = new Date();
    await this.approvals.save(approval);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'domestic_worker_earning.rejected',
      entityType: 'domestic_worker_earning_approval',
      entityId: approval.id,
      oldValues: { status: DomesticWorkerEarningApprovalStatus.PENDING },
      newValues: { status: approval.status, reason },
      meta,
    });
    return approval;
  }
}
