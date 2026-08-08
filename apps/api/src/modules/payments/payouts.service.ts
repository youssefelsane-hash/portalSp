import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { PAYOUT_COMPLETED_EVENT, PayoutCompletedEvent } from '../../common/events/payout-completed.event';
import { PAYOUT_REQUIRES_REVIEW_EVENT, PayoutRequiresReviewEvent } from '../../common/events/payout-requires-review.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { Payout, PayoutStatus } from './entities/payout.entity';
import { WalletsService } from './wallets.service';

// نفس القيم اللي كانت مزروعة في infra/migrations/0011_system.sql — دلوقتي بتتقرا فعلياً من
// settings مش ثابتة، والقيم هنا مجرد fallback لو الإعداد مش موجود لأي سبب (مش المصدر الحقيقي).
const MIN_PAYOUT_AMOUNT_CENTS_FALLBACK = 20_000;
const AUTO_APPROVE_LIMIT_CENTS_FALLBACK = 100_000;

@Injectable()
export class PayoutsService {
  constructor(
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly techniciansService: TechniciansService,
    private readonly walletsService: WalletsService,
    private readonly auditLog: AuditLogService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  private async nextPayoutNumber(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: number }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('PYT')");
    return number;
  }

  async requestPayout(technicianUserId: string, dto: RequestPayoutDto): Promise<Payout> {
    const minPayoutAmountCents = await this.settingsService.getNumber(
      'payouts.min_amount_cents',
      MIN_PAYOUT_AMOUNT_CENTS_FALLBACK,
    );
    if (dto.amount_cents < minPayoutAmountCents) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `أقل مبلغ صرف مسموح ${minPayoutAmountCents / 100} جنيه`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(technicianUserId);
    const wallet = await this.walletsService.findByUserIdOrThrow(technicianUserId);
    const autoApproveLimitCents = await this.settingsService.getNumber(
      'payouts.auto_approve_limit_cents',
      AUTO_APPROVE_LIMIT_CENTS_FALLBACK,
    );

    return this.dataSource.transaction(async (manager) => {
      // reserveForPayout بيقفل الصف ويرفض لو الرصيد مش كافي — ده اللي بيمنع صرفين متزامنين
      // ياكلوا نفس الرصيد (لو الفني بعت طلبين بالتوازي، التاني هيلاقي balance_cents اتخصم من الأول)
      await this.walletsService.reserveForPayout(wallet.id, dto.amount_cents, manager);

      const payoutNumber = await this.nextPayoutNumber(manager);
      const isAutoApproved = dto.amount_cents <= autoApproveLimitCents;

      const payout = manager.create(Payout, {
        payoutNumber,
        technicianId: technicianProfile.id,
        walletId: wallet.id,
        amountCents: dto.amount_cents,
        feeCents: 0,
        netAmountCents: dto.amount_cents,
        payoutMethod: dto.payout_method,
        destinationMasked: dto.destination_masked ?? null,
        payoutStatus: isAutoApproved ? PayoutStatus.APPROVED : PayoutStatus.UNDER_REVIEW,
        requestedAt: new Date(),
        reviewedAt: isAutoApproved ? new Date() : null,
      });
      await manager.save(payout);
      return payout;
    }).then((payout) => {
      // بره الـ transaction عمداً — نفس فلسفة كل حدث تاني في الكود ده
      if (payout.payoutStatus === PayoutStatus.UNDER_REVIEW) {
        this.events.emit(PAYOUT_REQUIRES_REVIEW_EVENT, new PayoutRequiresReviewEvent(payout.id, payout.payoutNumber, payout.amountCents));
      }
      return payout;
    });
  }

  async listForTechnician(userId: string): Promise<Payout[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.payouts.find({ where: { technicianId: profile.id }, order: { requestedAt: 'DESC' } });
  }

  private async findOrThrow(payoutId: string, manager?: EntityManager): Promise<Payout> {
    const repo = manager ? manager.getRepository(Payout) : this.payouts;
    const payout = await repo.findOne({ where: { id: payoutId } });
    if (!payout) {
      throw new ApiException(ErrorCode.VAL_001, 'طلب الصرف غير موجود', HttpStatus.NOT_FOUND);
    }
    return payout;
  }

  async adminApprove(adminUserId: string, payoutId: string, meta?: AuditActorMeta): Promise<Payout> {
    const payout = await this.findOrThrow(payoutId);
    if (payout.payoutStatus !== PayoutStatus.UNDER_REVIEW) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `مينفعش توافق على صرف في حالة ${payout.payoutStatus}`,
        HttpStatus.CONFLICT,
      );
    }
    const previousStatus = payout.payoutStatus;
    payout.payoutStatus = PayoutStatus.APPROVED;
    payout.reviewedAt = new Date();
    payout.reviewedByUserId = adminUserId;
    await this.payouts.save(payout);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'payout.approved',
      entityType: 'payout',
      entityId: payout.id,
      oldValues: { payout_status: previousStatus },
      newValues: { payout_status: payout.payoutStatus, amount_cents: payout.amountCents },
      meta,
    });
    return payout;
  }

  async adminReject(adminUserId: string, payoutId: string, reason: string, meta?: AuditActorMeta): Promise<Payout> {
    const result = await this.dataSource.transaction(async (manager) => {
      const payout = await this.findOrThrow(payoutId, manager);
      if (payout.payoutStatus === PayoutStatus.COMPLETED || payout.payoutStatus === PayoutStatus.REJECTED) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش ترفض صرف في حالة ${payout.payoutStatus}`,
          HttpStatus.CONFLICT,
        );
      }

      const previousStatus = payout.payoutStatus;
      // أهم حاجة هنا: نرجّع فلوس الفني اللي كانت محجوزة — لو نسيناها دي بتضيع فلوس حقيقية من رصيده
      await this.walletsService.releaseReservation(payout.walletId, payout.amountCents, manager);

      payout.payoutStatus = PayoutStatus.REJECTED;
      payout.rejectionReason = reason;
      payout.reviewedAt = new Date();
      payout.reviewedByUserId = adminUserId;
      await manager.save(payout);
      return { payout, previousStatus };
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'payout.rejected',
      entityType: 'payout',
      entityId: result.payout.id,
      oldValues: { payout_status: result.previousStatus },
      newValues: { payout_status: result.payout.payoutStatus, reason },
      meta,
    });
    return result.payout;
  }

  async adminComplete(adminUserId: string, payoutId: string, meta?: AuditActorMeta): Promise<Payout> {
    const result = await this.dataSource.transaction(async (manager) => {
      const payout = await this.findOrThrow(payoutId, manager);
      if (payout.payoutStatus !== PayoutStatus.APPROVED) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش تقفل صرف في حالة ${payout.payoutStatus} — لازم يكون approved الأول`,
          HttpStatus.CONFLICT,
        );
      }

      await this.walletsService.finalizePayout(
        payout.walletId,
        payout.netAmountCents,
        payout.id,
        `صرف ${payout.payoutNumber}`,
        manager,
      );

      const previousStatus = payout.payoutStatus;
      payout.payoutStatus = PayoutStatus.COMPLETED;
      payout.completedAt = new Date();
      payout.reviewedByUserId = payout.reviewedByUserId ?? adminUserId;
      await manager.save(payout);
      return { payout, previousStatus };
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'payout.completed',
      entityType: 'payout',
      entityId: result.payout.id,
      oldValues: { payout_status: result.previousStatus },
      newValues: { payout_status: result.payout.payoutStatus, net_amount_cents: result.payout.netAmountCents },
      meta,
    });

    this.events.emit(
      PAYOUT_COMPLETED_EVENT,
      new PayoutCompletedEvent(result.payout.id, result.payout.payoutNumber, result.payout.netAmountCents),
    );

    return result.payout;
  }
}
