import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../orders/entities/order.entity';

export type LiveMapTechnician = {
  id: string;
  fullName: string;
  technicianCode: string;
  isAvailable: boolean;
  isOnDuty: boolean;
  latitude: number;
  longitude: number;
  locationUpdatedAt: string | null;
};

export type LiveMapOrder = {
  id: string;
  orderNumber: string;
  serviceName: string;
  status: OrderStatus;
  scheduledAt: string | null;
  technicianId: string | null;
  latitude: number;
  longitude: number;
};

/**
 * مصدر بيانات الخريطة التشغيلية. الخريطة لا تنشئ أي حالة جديدة: موقع الفني هو آخر GPS حقيقي
 * أرسله التطبيق، وموقع الطلب هو عنوان العميل المحفوظ. النطاق محدود حتى لا تتحول شاشة المتابعة
 * إلى query غير محدود مع نمو البيانات.
 */
@Injectable()
export class AdminLiveMapService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getSnapshot(): Promise<{ technicians: LiveMapTechnician[]; orders: LiveMapOrder[]; generatedAt: string }> {
    const orderStatuses = [
      OrderStatus.SEARCHING_TECHNICIAN,
      OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
      OrderStatus.TECHNICIAN_ASSIGNED,
      OrderStatus.ACCEPTED,
      OrderStatus.TECHNICIAN_ON_WAY,
      OrderStatus.TECHNICIAN_ARRIVED,
      OrderStatus.IN_PROGRESS,
      OrderStatus.AWAITING_QUOTE_APPROVAL,
      OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
    ];

    const [technicians, orders] = await Promise.all([
      this.dataSource.query<
        {
          id: string;
          full_name: string;
          technician_code: string;
          is_available: boolean;
          is_on_duty: boolean;
          latitude: string;
          longitude: string;
          location_updated_at: Date | null;
        }[]
      >(
        `
        SELECT tp.id, u.full_name, tp.technician_code, tp.is_available, tp.is_on_duty,
               ST_Y(tp.current_location::geometry) AS latitude,
               ST_X(tp.current_location::geometry) AS longitude,
               tp.current_location_updated_at AS location_updated_at
        FROM technician_profiles tp
        JOIN users u ON u.id = tp.user_id
        WHERE tp.deleted_at IS NULL
          AND u.deleted_at IS NULL
          AND u.is_active = true
          AND u.is_blocked = false
          AND tp.verification_status = 'approved'
          AND tp.current_location IS NOT NULL
        ORDER BY tp.is_on_duty DESC, tp.is_available DESC, tp.current_location_updated_at DESC NULLS LAST
        LIMIT 1000
        `,
      ),
      this.dataSource.query<
        {
          id: string;
          order_number: string;
          service_name: string;
          order_status: OrderStatus;
          scheduled_at: Date | null;
          technician_id: string | null;
          latitude: string;
          longitude: string;
        }[]
      >(
        `
        SELECT o.id, o.order_number, s.name_ar AS service_name, o.order_status, o.scheduled_at, o.technician_id,
               ST_Y(a.location::geometry) AS latitude, ST_X(a.location::geometry) AS longitude
        FROM orders o
        JOIN addresses a ON a.id = o.address_id AND a.deleted_at IS NULL
        JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND o.order_status = ANY($1::order_status[])
          AND (o.scheduled_at IS NULL OR o.scheduled_at BETWEEN now() - interval '1 day' AND now() + interval '14 days')
        ORDER BY
          CASE WHEN o.order_status IN ('technician_on_way', 'technician_arrived', 'in_progress') THEN 0 ELSE 1 END,
          o.scheduled_at ASC NULLS FIRST
        LIMIT 500
        `,
        [orderStatuses],
      ),
    ]);

    return {
      technicians: technicians.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        technicianCode: row.technician_code,
        isAvailable: row.is_available,
        isOnDuty: row.is_on_duty,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        locationUpdatedAt: row.location_updated_at?.toISOString() ?? null,
      })),
      orders: orders.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        serviceName: row.service_name,
        status: row.order_status,
        scheduledAt: row.scheduled_at?.toISOString() ?? null,
        technicianId: row.technician_id,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
