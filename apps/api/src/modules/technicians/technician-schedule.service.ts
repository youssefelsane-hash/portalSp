import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
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

    // فحص التداخل مع سلوتات موجودة لنفس اليوم — مفيش DB constraint (راجع تعليق migration 0058
    // للسبب: بيحتاج امتداد btree_gist اتجنبناه في أول نسخة)، الفحص هنا بس. المخاطرة مقبولة لأن
    // الفني هو المالك الوحيد لجدوله (كتابة من عميل واحد، مش سباق متعدد الأطراف زي حجز الطلبات).
    const existingSameDay = await this.slots.find({
      where: { technicianId: technicianProfileId, slotDate: dto.slot_date },
    });
    const overlaps = existingSameDay.some(
      (existing) => existing.deletedAt === null && dto.start_time < existing.endTime && dto.end_time > existing.startTime,
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
    await this.slots.save(slot);
    return slot;
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
   */
  async bookSlot(slotId: string, orderId: string): Promise<boolean> {
    const result = await this.slots
      .createQueryBuilder()
      .update(TechnicianScheduleSlot)
      .set({ status: TechnicianScheduleSlotStatus.BOOKED, orderId })
      .where('id = :slotId AND status = :availableStatus', { slotId, availableStatus: TechnicianScheduleSlotStatus.AVAILABLE })
      .execute();
    return (result.affected ?? 0) > 0;
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
}
