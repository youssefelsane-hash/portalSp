import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Wallet, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxDirection, WalletTxType } from './entities/wallet-transaction.entity';

export interface DoubleEntryParams {
  fromWalletId: string;
  toWalletId: string;
  amountCents: number;
  transactionType: WalletTxType;
  referenceType: string;
  referenceId: string;
  descriptionAr: string;
  performedByUserId?: string | null;
  /** لازم يكون true بس للخصومات اللي النظام نفسه بيعملها (زي عمولة الكاش) — أي طلب سحب/دفع من مستخدم لازم false. */
  allowNegativeBalance?: boolean;
}

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private readonly walletTransactions: Repository<WalletTransaction>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getOrCreateWallet(userId: string, ownerType: WalletOwnerType, manager?: EntityManager): Promise<Wallet> {
    const repository = manager?.getRepository(Wallet) ?? this.wallets;
    const existing = await repository.findOne({ where: { ownerUserId: userId } });
    if (existing) return existing;

    await repository
      .createQueryBuilder()
      .insert()
      .into(Wallet)
      .values({ ownerUserId: userId, ownerType, currencyCode: 'EGP' })
      .orIgnore()
      .execute();

    const wallet = await repository.findOne({ where: { ownerUserId: userId } });
    if (!wallet) {
      throw new ApiException(ErrorCode.VAL_001, 'تعذر إنشاء المحفظة', HttpStatus.CONFLICT);
    }
    return wallet;
  }

  async findByUserIdOrThrow(userId: string, manager?: EntityManager): Promise<Wallet> {
    const wallet = await (manager?.getRepository(Wallet) ?? this.wallets).findOne({ where: { ownerUserId: userId } });
    if (!wallet) {
      throw new ApiException(ErrorCode.VAL_001, 'المحفظة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return wallet;
  }

  async listTransactionsForUser(userId: string): Promise<WalletTransaction[]> {
    const wallet = await this.findByUserIdOrThrow(userId);
    return this.walletTransactions.find({ where: { walletId: wallet.id }, order: { createdAt: 'DESC' } });
  }

  private async nextTransactionNumber(manager: EntityManager): Promise<string> {
    const [{ next_human_readable_number: number }] = await manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('TXN')");
    return number;
  }

  /**
   * قيد مزدوج ذرّي: خصم من محفظة وإضافة لمحفظة تانية، بقفل على الاتنين بترتيب ثابت (بالـ id)
   * عشان نمنع deadlock لو حصل تحويلين متزامنين بالعكس بين نفس المحفظتين.
   *
   * لو `manager` اتبعت، بيشارك في transaction الطالب (مهم عشان تحديث حالة الطلب + القيد المالي
   * يبقوا ذرّيين مع بعض — لو أي جزء فشل، الاتنين يرجعوا زي ما كانوا). لو مبعتش، بيفتح transaction
   * خاصة بيه لوحده.
   */
  async doubleEntry(
    params: DoubleEntryParams,
    manager?: EntityManager,
  ): Promise<{ debit: WalletTransaction; credit: WalletTransaction }> {
    if (manager) return this.doubleEntryWithManager(params, manager);
    return this.dataSource.transaction((txManager) => this.doubleEntryWithManager(params, txManager));
  }

  private async doubleEntryWithManager(
    params: DoubleEntryParams,
    manager: EntityManager,
    allowFrozenWallets = false,
  ): Promise<{ debit: WalletTransaction; credit: WalletTransaction }> {
    if (params.amountCents <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'المبلغ لازم يكون أكبر من صفر', HttpStatus.BAD_REQUEST);
    }
    if (params.fromWalletId === params.toWalletId) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تحويل من محفظة لنفسها', HttpStatus.BAD_REQUEST);
    }

    // بنقفل الاتنين بترتيب ثابت (بالـ id) بغض النظر مين from ومين to، عشان نمنع deadlock.
    // مهم: بنتأكد إن الاتنين موجودين قبل أي محاولة نطابق مين هو مين — لو محفظة واحدة مش موجودة
    // ومطابقناها غلط، ممكن from/to يبقوا بيأشروا لنفس المحفظة الموجودة فيتلغي الخصم مع الإضافة
    // بصمت من غير ما حد ياخد error، وده أخطر حاجة ممكن تحصل في نظام مالي.
    const [firstId, secondId] = [params.fromWalletId, params.toWalletId].sort();
    const first = await manager
      .createQueryBuilder(Wallet, 'w')
      .setLock('pessimistic_write')
      .where('w.id = :id', { id: firstId })
      .getOne();
    const second = await manager
      .createQueryBuilder(Wallet, 'w')
      .setLock('pessimistic_write')
      .where('w.id = :id', { id: secondId })
      .getOne();

    if (!first || !second) {
      throw new ApiException(ErrorCode.VAL_001, 'محفظة غير موجودة', HttpStatus.NOT_FOUND);
    }

    const fromWallet = first.id === params.fromWalletId ? first : second;
    const toWallet = first.id === params.toWalletId ? first : second;
    if (fromWallet.isFrozen && !allowFrozenWallets) {
      throw new ApiException(ErrorCode.PAY_002, fromWallet.frozenReason ?? 'المحفظة مجمّدة', HttpStatus.FORBIDDEN);
    }
    if (toWallet.isFrozen && !allowFrozenWallets) {
      throw new ApiException(ErrorCode.PAY_002, 'محفظة الطرف التاني مجمّدة', HttpStatus.FORBIDDEN);
    }
    if (!params.allowNegativeBalance && fromWallet.balanceCents < params.amountCents) {
      throw new ApiException(ErrorCode.PAY_002, 'رصيد غير كافٍ', HttpStatus.PAYMENT_REQUIRED);
    }

    const txNumberDebit = await this.nextTransactionNumber(manager);
    const txNumberCredit = await this.nextTransactionNumber(manager);

    const fromBalanceBefore = fromWallet.balanceCents;
    fromWallet.balanceCents -= params.amountCents;
    if (params.transactionType === WalletTxType.WITHDRAWAL) {
      fromWallet.totalWithdrawnCents += params.amountCents;
    }
    await manager.save(fromWallet);

    const toBalanceBefore = toWallet.balanceCents;
    toWallet.balanceCents += params.amountCents;
    if (params.transactionType === WalletTxType.ORDER_EARNING || params.transactionType === WalletTxType.BONUS) {
      toWallet.totalEarnedCents += params.amountCents;
    }
    await manager.save(toWallet);

    const debit = manager.create(WalletTransaction, {
      walletId: fromWallet.id,
      transactionNumber: txNumberDebit,
      direction: WalletTxDirection.DEBIT,
      transactionType: params.transactionType,
      amountCents: params.amountCents,
      balanceBeforeCents: fromBalanceBefore,
      balanceAfterCents: fromWallet.balanceCents,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      descriptionAr: params.descriptionAr,
      performedByUserId: params.performedByUserId ?? null,
    });
    await manager.save(debit);

    const credit = manager.create(WalletTransaction, {
      walletId: toWallet.id,
      transactionNumber: txNumberCredit,
      direction: WalletTxDirection.CREDIT,
      transactionType: params.transactionType,
      amountCents: params.amountCents,
      balanceBeforeCents: toBalanceBefore,
      balanceAfterCents: toWallet.balanceCents,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      descriptionAr: params.descriptionAr,
      performedByUserId: params.performedByUserId ?? null,
    });
    await manager.save(credit);

    return { debit, credit };
  }

  /** بيعكس قيد مزدوج قديم بقيد جديد بالعكس — الأصلي بيفضل زي ما هو للأبد (immutable ledger). */
  async reverseDoubleEntry(
    original: { debit: WalletTransaction; credit: WalletTransaction },
    reasonAr: string,
    performedByUserId?: string,
    manager?: EntityManager,
  ): Promise<{ debit: WalletTransaction; credit: WalletTransaction }> {
    const run = async (txManager: EntityManager) => {
      const locked = new Map<string, WalletTransaction>();
      for (const transactionId of [original.debit.id, original.credit.id].sort()) {
        const transaction = await txManager
          .createQueryBuilder(WalletTransaction, 'transaction')
          .setLock('pessimistic_write')
          .where('transaction.id = :transactionId', { transactionId })
          .getOne();
        if (!transaction) {
          throw new ApiException(ErrorCode.VAL_001, 'القيد الأصلي غير موجود', HttpStatus.NOT_FOUND);
        }
        locked.set(transaction.id, transaction);
      }

      const originalDebit = locked.get(original.debit.id)!;
      const originalCredit = locked.get(original.credit.id)!;
      if (
        originalDebit.direction !== WalletTxDirection.DEBIT ||
        originalCredit.direction !== WalletTxDirection.CREDIT ||
        originalDebit.amountCents !== originalCredit.amountCents ||
        originalDebit.walletId === originalCredit.walletId ||
        originalDebit.referenceType !== originalCredit.referenceType ||
        originalDebit.referenceId !== originalCredit.referenceId
      ) {
        throw new ApiException(ErrorCode.VAL_001, 'القيدان الأصليان لا يمثلان قيدًا مزدوجًا متسقًا', HttpStatus.CONFLICT);
      }
      if (originalDebit.isReversed || originalCredit.isReversed) {
        if (
          !originalDebit.isReversed ||
          !originalCredit.isReversed ||
          !originalDebit.reversalTransactionId ||
          !originalCredit.reversalTransactionId
        ) {
          throw new ApiException(ErrorCode.VAL_001, 'حالة عكس القيد غير متسقة وتحتاج مراجعة', HttpStatus.CONFLICT);
        }
        const debit = await txManager.findOne(WalletTransaction, {
          where: { id: originalDebit.reversalTransactionId },
        });
        const credit = await txManager.findOne(WalletTransaction, {
          where: { id: originalCredit.reversalTransactionId },
        });
        if (!debit || !credit) {
          throw new ApiException(ErrorCode.VAL_001, 'قيد العكس المسجل غير موجود', HttpStatus.CONFLICT);
        }
        if (
          debit.direction !== WalletTxDirection.DEBIT ||
          credit.direction !== WalletTxDirection.CREDIT ||
          debit.amountCents !== originalDebit.amountCents ||
          credit.amountCents !== originalCredit.amountCents ||
          debit.walletId !== originalCredit.walletId ||
          credit.walletId !== originalDebit.walletId
        ) {
          throw new ApiException(ErrorCode.VAL_001, 'قيد العكس المسجل غير متسق وتحتاج حالته مراجعة', HttpStatus.CONFLICT);
        }
        return { debit, credit };
      }

      const reversed = await this.doubleEntryWithManager(
        {
          fromWalletId: originalCredit.walletId,
          toWalletId: originalDebit.walletId,
          amountCents: originalDebit.amountCents,
          transactionType: WalletTxType.ADJUSTMENT,
          referenceType: originalDebit.referenceType ?? 'reversal',
          referenceId: originalDebit.referenceId ?? originalDebit.id,
          descriptionAr: `عكس قيد: ${reasonAr}`,
          performedByUserId: performedByUserId ?? null,
          allowNegativeBalance: true, // العكس لازم ينجح دايماً — مينفعش رصيد ناقص يمنع تصحيح غلطة
        },
        txManager,
        true,
      );

      await txManager.update(WalletTransaction, originalDebit.id, {
        isReversed: true,
        reversalTransactionId: reversed.debit.id,
      });
      await txManager.update(WalletTransaction, originalCredit.id, {
        isReversed: true,
        reversalTransactionId: reversed.credit.id,
      });

      return reversed;
    };

    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  private async lockWallet(walletId: string, manager: EntityManager): Promise<Wallet> {
    const wallet = await manager
      .createQueryBuilder(Wallet, 'w')
      .setLock('pessimistic_write')
      .where('w.id = :id', { id: walletId })
      .getOne();
    if (!wallet) {
      throw new ApiException(ErrorCode.VAL_001, 'محفظة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return wallet;
  }

  /**
   * بيحجز مبلغ لصرف طلبه فني — بينقله من balance_cents (قابل للاستخدام) لـ reserved_balance_cents
   * (محجوز، مش قابل يتصرف فيه تاني)، عشان مينفعش نفس الرصيد يتصرف مرتين لو الفني طلب صرفين
   * متزامنين. القفل هنا بيمنع الـ race condition ده فعلياً، مش بس منطقياً.
   */
  async reserveForPayout(walletId: string, amountCents: number, manager: EntityManager): Promise<Wallet> {
    const wallet = await this.lockWallet(walletId, manager);
    if (wallet.isFrozen) {
      throw new ApiException(ErrorCode.PAY_002, wallet.frozenReason ?? 'المحفظة مجمّدة', HttpStatus.FORBIDDEN);
    }
    if (wallet.balanceCents < amountCents) {
      throw new ApiException(ErrorCode.PAY_002, 'رصيد غير كافٍ', HttpStatus.PAYMENT_REQUIRED);
    }
    wallet.balanceCents -= amountCents;
    wallet.reservedBalanceCents += amountCents;
    return manager.save(wallet);
  }

  /**
   * بيلغي حجز (رفض الصرف مثلاً) — يرجّع المبلغ من reserved_balance_cents لـ balance_cents.
   *
   * **بَقّة حقيقية اتلقطت واتصلحت (docs/08 §20 بند 9)**: قبل الفحص تحت، الدالة كانت بتطرح
   * `amountCents` من `reservedBalanceCents` من غير أي تحقق إن المحجوز أصلاً كافٍ — عكس
   * `finalizePayout()` (تحت) اللي عندها نفس الفحص بالظبط. يعني لو `adminReject()` اتنادت مرتين
   * متزامنتين على نفس الصرف (double-click، إعادة محاولة بعد timeout، إلخ) — الاتنين كانوا بيعدّوا
   * فحص `payoutStatus` (بيقرا الحالة القديمة قبل ما أي حد يلتزم)، وبعدين بيتسلسلوا على قفل
   * المحفظة، والتاني كان بيطرح المبلغ **تاني** من `reservedBalanceCents` (يروح سالب بصمت) ويضيفه
   * **تاني** لـ`balanceCents` — فلوس حقيقية بتتخلق من العدم للفني. الفحص ده بيقفل الثغرة عند
   * مصدرها الحقيقي (نفس مبدأ `finalizePayout`)، مش بس عرض عدم اتساق.
   */
  async releaseReservation(walletId: string, amountCents: number, manager: EntityManager): Promise<Wallet> {
    const wallet = await this.lockWallet(walletId, manager);
    if (wallet.reservedBalanceCents < amountCents) {
      throw new ApiException(ErrorCode.PAY_002, 'المبلغ المحجوز أقل من مبلغ الحجز المطلوب إلغاؤه', HttpStatus.CONFLICT);
    }
    wallet.reservedBalanceCents -= amountCents;
    wallet.balanceCents += amountCents;
    return manager.save(wallet);
  }

  /**
   * بيقفل الصرف نهائياً — المبلغ بيخرج من reserved_balance_cents للأبد (مش هيرجع لـ balance_cents
   * تاني)، وبيتسجّل قيد مزدوج حقيقي مقابل محفظة المنصة عشان الدفتر يفضل متوازن.
   */
  async finalizePayout(
    walletId: string,
    amountCents: number,
    referenceId: string,
    descriptionAr: string,
    manager: EntityManager,
  ): Promise<{ debit: WalletTransaction; credit: WalletTransaction }> {
    // نجيب id محفظة المنصة الأول (من غير قفل) بس عشان نعرف ترتيب القفل الصحيح — لازم نقفل
    // بترتيب ثابت زي doubleEntryWithManager بالظبط، وإلا فيه احتمال حقيقي لـ deadlock لو
    // العمليتين اشتغلوا في نفس اللحظة على نفس المحفظتين بترتيب عكسي.
    const platformWalletRow = await manager.findOne(Wallet, { where: { ownerType: WalletOwnerType.PLATFORM } });
    if (!platformWalletRow) {
      throw new ApiException(ErrorCode.VAL_001, 'محفظة المنصة غير موجودة', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const [firstId, secondId] = [walletId, platformWalletRow.id].sort();
    const first = await this.lockWallet(firstId, manager);
    const second = firstId === secondId ? first : await this.lockWallet(secondId, manager);

    const wallet = first.id === walletId ? first : second;
    const platformWallet = first.id === platformWalletRow.id ? first : second;

    if (wallet.reservedBalanceCents < amountCents) {
      throw new ApiException(ErrorCode.PAY_002, 'المبلغ المحجوز أقل من مبلغ الصرف', HttpStatus.CONFLICT);
    }

    const walletBalanceBefore = wallet.balanceCents; // مبيتغيّرش (كان اتخصم وقت الحجز)، بنسجله كمرجع بس
    wallet.reservedBalanceCents -= amountCents;
    wallet.totalWithdrawnCents += amountCents;
    await manager.save(wallet);

    const platformBalanceBefore = platformWallet.balanceCents;
    platformWallet.balanceCents += amountCents;
    await manager.save(platformWallet);

    const txNumberDebit = await this.nextTransactionNumber(manager);
    const debit = manager.create(WalletTransaction, {
      walletId: wallet.id,
      transactionNumber: txNumberDebit,
      direction: WalletTxDirection.DEBIT,
      transactionType: WalletTxType.WITHDRAWAL,
      amountCents,
      balanceBeforeCents: walletBalanceBefore,
      balanceAfterCents: wallet.balanceCents,
      referenceType: 'payout',
      referenceId,
      descriptionAr,
    });
    await manager.save(debit);

    const txNumberCredit = await this.nextTransactionNumber(manager);
    const credit = manager.create(WalletTransaction, {
      walletId: platformWallet.id,
      transactionNumber: txNumberCredit,
      direction: WalletTxDirection.CREDIT,
      transactionType: WalletTxType.WITHDRAWAL,
      amountCents,
      balanceBeforeCents: platformBalanceBefore,
      balanceAfterCents: platformWallet.balanceCents,
      referenceType: 'payout',
      referenceId,
      descriptionAr,
    });
    await manager.save(credit);

    return { debit, credit };
  }
}
