import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';

/** Shared assignment eligibility used by technician acceptance and admin reassignment. */
@Injectable()
export class TechnicianAssignmentGuardService {
  async lockTechnician(manager: EntityManager, technicianId: string): Promise<TechnicianProfile> {
    const technician = await manager
      .createQueryBuilder(TechnicianProfile, 'technician')
      .setLock('pessimistic_write')
      .where('technician.id = :technicianId', { technicianId })
      .getOne();
    if (!technician) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return technician;
  }

  async assertEligible(manager: EntityManager, technician: TechnicianProfile, order: Order): Promise<void> {
    if (technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    if (
      order.bookingMode !== BookingMode.EMERGENCY &&
      (!technician.isAvailable || !technician.isOnDuty)
    ) {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني غير متاح أو خارج الوردية حاليًا', HttpStatus.CONFLICT);
    }
    if (!technician.currentLocation) {
      throw new ApiException(ErrorCode.ORDR_003, 'لا يوجد موقع حالي للفني يسمح بالتعيين', HttpStatus.CONFLICT);
    }

    const [capability] = await manager.query<
      { has_service: boolean; has_zone: boolean; level_configured: boolean; decision_limit_cents: number | null }[]
    >(
      `SELECT
         EXISTS (
           SELECT 1 FROM technician_services
           WHERE technician_id = $1 AND service_id = $2 AND is_active = true
         ) AS has_service,
         EXISTS (
           SELECT 1 FROM technician_zones
           WHERE technician_id = $1 AND service_zone_id = $3 AND is_active = true
         ) AS has_zone,
         EXISTS (
           SELECT 1 FROM technician_level_config WHERE level = $4
         ) AS level_configured,
         (SELECT decision_limit_cents FROM technician_level_config WHERE level = $4) AS decision_limit_cents`,
      [technician.id, order.serviceId, order.serviceZoneId, technician.currentLevel],
    );
    if (!capability?.has_service || !capability.has_zone) {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني غير مؤهل للخدمة أو نطاق الطلب', HttpStatus.CONFLICT);
    }
    if (!capability.level_configured) {
      throw new ApiException(ErrorCode.ORDR_003, 'مستوى الفني غير مهيأ للتعيين', HttpStatus.CONFLICT);
    }
    if (capability.decision_limit_cents !== null && order.totalAmountCents > Number(capability.decision_limit_cents)) {
      throw new ApiException(ErrorCode.ORDR_003, 'قيمة الطلب أعلى من حد قرار مستوى الفني', HttpStatus.CONFLICT);
    }

    const [activeOrder] = await manager.query<{ id: string }[]>(
      `SELECT id FROM orders
       WHERE technician_id = $1
         AND id != $2
         AND order_status = ANY($3::order_status[])
         AND deleted_at IS NULL
       LIMIT 1`,
      [technician.id, order.id, ACTIVE_TECHNICIAN_ORDER_STATUSES],
    );
    if (activeOrder) {
      throw new ApiException(ErrorCode.ORDR_003, 'الفني عنده طلب نشط بالفعل', HttpStatus.CONFLICT);
    }

    if (order.scheduledAt) {
      const [conflict] = await manager.query<{ id: string }[]>(
        `SELECT tss.id
         FROM technician_schedule_slots tss
         JOIN services s ON s.id = $2
         WHERE tss.technician_id = $1
           AND tss.status = 'booked'
           AND tss.deleted_at IS NULL
           AND tss.order_id IS DISTINCT FROM $3
           AND tss.slot_date = ($4::timestamptz)::date
           AND tss.start_time < (($4::timestamptz + (COALESCE(s.estimated_duration_minutes, 60) || ' minutes')::interval))::time
           AND tss.end_time > ($4::timestamptz)::time
         LIMIT 1`,
        [technician.id, order.serviceId, order.id, order.scheduledAt],
      );
      if (conflict) {
        throw new ApiException(ErrorCode.ORDR_003, 'الفني عنده موعد متعارض مع الطلب', HttpStatus.CONFLICT);
      }
    }
  }
}
