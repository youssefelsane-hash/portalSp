import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from './entities/technician-schedule-slot.entity';

// جدولة الفني الحقيقية (docs/08 §2، ADR-0002) — سلوتات كصفوف صريحة، الفني بيديرها بنفسه
// (زي ما المالك طلب: "يخش كل أسبوع يحط اللي هو فاضي فيه"). موديول فرعي داخل technicians مش
// مستقل، لأنه امتداد مباشر لبيانات الفني نفسه.
@Injectable()
export class TechnicianScheduleService {
  constructor(@InjectRepository(TechnicianScheduleSlot) private readonly slots: Repository<TechnicianScheduleSlot>) {}

  async createSlot(technicianProfileId: string, dto: CreateScheduleSlotDto): Promise<TechnicianScheduleSlot> {
    if (dto.end_time <= dto.start_time) {
      throw new ApiException(ErrorCode.VAL_001, 'وقت النهاية لازم يكون بعد وقت البداية', HttpStatus.BAD_REQUEST);
    }

    // فحص سريع لرسالة UX واضحة. Migration 0118's exclusion constraint هو الضمان الحقيقي تحت السباق.
    const existingSameDay = await this.slots.find({
      where: { technicianId: technicianProfileId, slotDate: dto.slot_date },
    });
    const startTime = normalizeTime(dto.start_time);
    const endTime = normalizeTime(dto.end_time);
    const overlaps = existingSameDay.some(
      (existing) =>
        existing.deletedAt === null &&
        startTime < normalizeTime(existing.endTime) &&
        endTime > normalizeTime(existing.startTime),
    );
    if (overlaps) {
      throw new ApiException(ErrorCode.VAL_001, 'السلوت ده بيتداخل مع سلوت موجود بالفعل في نفس اليوم', HttpStatus.CONFLICT);
    }

    const slot = this.slots.create({
      technicianId: technicianProfileId,
      slotDate: dto.slot_date,
      startTime: dto.start_time,
      endTime: dto.end_time,
      status: dto.status ?? TechnicianScheduleSlotStatus.AVAILABLE,
      notesAr: dto.notes_ar ?? null,
    });
    try {
      await this.slots.save(slot);
      return slot;
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23P01') {
        throw new ApiException(ErrorCode.VAL_001, 'السلوت ده بيتداخل مع سلوت موجود بالفعل في نفس اليوم', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  listForTechnician(technicianProfileId: string, from?: string, to?: string): Promise<TechnicianScheduleSlot[]> {
    return this.slots.find({
      where: {
        technicianId: technicianProfileId,
        ...(from && to ? { slotDate: Between(from, to) } : {}),
      },
      order: { slotDate: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * ربط الجدولة بإنشاء الطلب (docs/08 §2-§3) — العميل بيختار سلوت `available` من جدول فني بعينه
   * (`GET /technicians/:id/schedule`) قبل ما يوصل لـ`OrdersService.create()`. بيرمي واضح لو
   * السلوت مش موجود/محجوز بالفعل/اتشال — بدل ما `OrdersService` تفترض ضمنيًا إنه متاح وتكتشف
   * الفشل بس وقت `bookSlot()` الذرّي جوّه الـtransaction.
   */
  async findAvailableSlotOrThrow(slotId: string): Promise<TechnicianScheduleSlot> {
    const slot = await this.slots.findOne({ where: { id: slotId, status: TechnicianScheduleSlotStatus.AVAILABLE } });
    if (!slot) {
      throw new ApiException(ErrorCode.VAL_001, 'السلوت ده مش متاح للحجز', HttpStatus.CONFLICT);
    }
    return slot;
  }

  private async findOwnedSlotOrThrow(technicianProfileId: string, slotId: string): Promise<TechnicianScheduleSlot> {
    const slot = await this.slots.findOne({ where: { id: slotId, technicianId: technicianProfileId } });
    if (!slot) {
      throw new ApiException(ErrorCode.VAL_001, 'السلوت غير موجود', HttpStatus.NOT_FOUND);
    }
    return slot;
  }

  async deleteSlot(technicianProfileId: string, slotId: string): Promise<void> {
    const slot = await this.findOwnedSlotOrThrow(technicianProfileId, slotId);
    if (slot.status === TechnicianScheduleSlotStatus.BOOKED) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تمسح سلوت محجوز بطلب فعلي', HttpStatus.CONFLICT);
    }
    await this.slots.softDelete(slotId);
  }

  /**
   * حجز سلوت لطلب — عملية ذرّية عن طريق UPDATE واحد بشرط status='available' (مش
   * SELECT-then-UPDATE اللي ممكن يسمح بسباق بين طلبين بيحاولوا يحجزوا نفس اللحظة). بيرجع
   * false لو السلوت اتحجز بالفعل (من عميل تاني، أو اتشال) — الـcaller (تدفق اختيار الفني،
   * §3 من docs/08) لازم يتعامل مع الحالة دي برجوع واضح للعميل مش افتراض نجاح صامت.
   *
   * `manager` اختياري — `OrdersService.create()` بيبعت manager الـtransaction بتاعتها عشان
   * "الطلب اتعمل" و"السلوت اتحجز" يبقوا عملية ذرّية واحدة (لو الحجز فشل، الطلب كله بيتلغي/يترول
   * باك، مش يتعمل طلب بلا سلوت فعلي بيشاور عليه).
   */
  async bookSlot(slotId: string, orderId: string, manager?: EntityManager): Promise<boolean> {
    const qb = manager ? manager.createQueryBuilder() : this.slots.createQueryBuilder();
    const result = await qb
      .update(TechnicianScheduleSlot)
      .set({ status: TechnicianScheduleSlotStatus.BOOKED, orderId })
      .where('id = :slotId AND status = :availableStatus', { slotId, availableStatus: TechnicianScheduleSlotStatus.AVAILABLE })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** السلوت المحجوز حاليًا لطلب معيّن (لو موجود) — docs/08 §22 بند 9-12، بداية إعادة الجدولة. */
  findSlotForOrder(orderId: string): Promise<TechnicianScheduleSlot | null> {
    return this.slots.findOne({ where: { orderId, status: TechnicianScheduleSlotStatus.BOOKED } });
  }

  /**
   * إعادة جدولة — تحرير السلوت القديم وحجز الجديد ذرّيًا جوّه نفس الـtransaction (docs/08 §22
   * بند 9-12). لو حجز الجديد فشل (اتحجز من عميل تاني بينهم، أو اتشال)، الـcaller (OrdersService
   * .reschedule) بيرمي ويرجع الـtransaction بالكامل — يعني تحرير القديم بيترول باك برضه، العميل
   * ميخسرش موعده الأصلي بسبب محاولة إعادة جدولة فشلت. نفس ضمان "صفر حجز مزدوج صامت" اللي
   * bookSlot() الذرّية بتوفره من الأساس.
   */
  async rescheduleSlot(orderId: string, newSlotId: string, manager: EntityManager): Promise<boolean> {
    await manager
      .createQueryBuilder()
      .update(TechnicianScheduleSlot)
      .set({ status: TechnicianScheduleSlotStatus.AVAILABLE, orderId: null })
      .where('orderId = :orderId', { orderId })
      .execute();
    return this.bookSlot(newSlotId, orderId, manager);
  }

  /** بيرجّع سلوت اتحجز لموقف — لو الطلب اتلغى مثلاً، السلوت يرجع متاح تاني. */
  async releaseSlotForOrder(orderId: string): Promise<void> {
    await this.slots
      .createQueryBuilder()
      .update(TechnicianScheduleSlot)
      .set({ status: TechnicianScheduleSlotStatus.AVAILABLE, orderId: null })
      .where('orderId = :orderId', { orderId })
      .execute();
  }

  /**
   * تعديل جماعي سريع للإتاحة (docs/08 §34.3) — بدل ما الفني يفتح كل يوم لوحده، بيبعت مجموعة
   * تواريخ مرة واحدة و`block`/`unblock`. مفيش migration/enum جديد — نفس الجدول، نفس المعنى
   * (ADR-0017): `block` = صف `blocked` كامل اليوم (الاستثناء الصريح الوحيد)، `unblock` = مسح أي
   * استثناء موجود ليوم بعينه (الرجوع للافتراضي "متاح" بغياب أي صف). يوم عليه سلوت `booked` فعلي
   * (طلب حقيقي مرتبط بيه) بيتستبعد من العملية الجماعية — الفني ميقدرش "يفك حظر" يوم عنده حجز حقيقي
   * فيه من هنا (ده مش استثناء بيتحكم فيه، ده طلب فعلي)، والنتيجة بترجع `skipped_booked` واضحة له.
   */
  async bulkSetAvailability(
    technicianProfileId: string,
    dates: string[],
    action: 'block' | 'unblock',
    notesAr?: string,
  ): Promise<{ date: string; status: 'applied' | 'skipped_booked' }[]> {
    const uniqueDates = [...new Set(dates)];
    const results: { date: string; status: 'applied' | 'skipped_booked' }[] = [];

    for (const date of uniqueDates) {
      await this.slots.manager.transaction(async (manager) => {
        const existing = await manager.find(TechnicianScheduleSlot, {
          where: { technicianId: technicianProfileId, slotDate: date },
        });
        const live = existing.filter((s) => s.deletedAt === null);
        if (live.some((s) => s.status === TechnicianScheduleSlotStatus.BOOKED)) {
          results.push({ date, status: 'skipped_booked' });
          return;
        }

        if (live.length > 0) {
          await manager.softDelete(
            TechnicianScheduleSlot,
            live.map((s) => s.id),
          );
        }

        if (action === 'block') {
          const slot = manager.create(TechnicianScheduleSlot, {
            technicianId: technicianProfileId,
            slotDate: date,
            startTime: '00:00:00',
            endTime: '23:59:59',
            status: TechnicianScheduleSlotStatus.BLOCKED,
            notesAr: notesAr ?? null,
          });
          await manager.save(slot);
        }
        // action === 'unblock': مسح أي صف موجود كافي — غياب الصف يرجّع اليوم لافتراض "متاح".

        results.push({ date, status: 'applied' });
      });
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Rebuilds missed release events from durable order state without an unbounded scan. */
  async reconcileReleasedSlots(batchSize = 25): Promise<number> {
    const rows = await this.slots.query(
      `WITH candidates AS (
         SELECT slot.id
         FROM technician_schedule_slots slot
         JOIN orders o ON o.id = slot.order_id
         WHERE slot.status = 'booked'
           AND slot.deleted_at IS NULL
           AND (
             o.order_status IN ('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system')
             OR o.order_status = 'awaiting_technician_reselection'
             OR (o.order_status = 'searching_technician' AND o.requested_technician_id IS DISTINCT FROM slot.technician_id)
             OR (o.technician_id IS NOT NULL AND o.technician_id IS DISTINCT FROM slot.technician_id)
           )
         ORDER BY slot.created_at
         LIMIT $1
       )
       UPDATE technician_schedule_slots slot
       SET status = 'available', order_id = NULL, updated_at = now()
       FROM candidates
       WHERE slot.id = candidates.id
       RETURNING slot.id`,
      [Math.max(1, Math.floor(batchSize))],
    );
    return rows.length;
  }
}

function normalizeTime(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}
