import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { OrderStatus } from '../orders/entities/order.entity';
import { AddressesService } from '../customers/addresses.service';
import { AddressResponseDto, toAddressResponseDto } from '../customers/dto/address-response.dto';

// نفس تعريف AdminTechnician360Service (technicians/admin-technician-360.service.ts) — طلبات
// "حالية/قادمة" = ACTIVE_TECHNICIAN_ORDER_STATUSES زائد technician_assigned (طلب فريق قائده
// اتعيّن بس طاقمه لسه ناقص). مُكرَّر هنا محليًا (مفيش export مشترك) لأن الفلترة مختلفة —
// customer_id هنا بدل technician_id هناك.
const CURRENT_UPCOMING_ORDER_STATUSES: OrderStatus[] = [OrderStatus.TECHNICIAN_ASSIGNED, ...ACTIVE_TECHNICIAN_ORDER_STATUSES];

export interface AdminCustomer360Order {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  scheduledAt: Date | null;
  serviceNameAr: string;
}

export interface AdminCustomer360ComplaintRow {
  id: string;
  complaintNumber: string;
  severity: string;
  status: string;
  createdAt: Date;
}

export interface AdminCustomer360Complaints {
  openCount: number;
  totalCount: number;
  recent: AdminCustomer360ComplaintRow[];
}

/** تقييم فني للعميل على طلب واحد — للأدمن بس (docs/08 §68). */
export interface AdminCustomer360RatingRow {
  ratingId: string;
  orderId: string;
  orderNumber: string;
  overallRating: number;
  comment: string | null;
  createdAt: Date;
}

export interface AdminCustomer360RatingsReceived {
  averageRating: number | null;
  totalCount: number;
  /** آخر 10 تقييمات بالتفصيل — «كل طلبية على حدة» (طلب مالك صريح، docs/08 §68). */
  recent: AdminCustomer360RatingRow[];
}

export interface AdminCustomer360Profile {
  addresses: AddressResponseDto[];
  currentAndUpcomingOrders: AdminCustomer360Order[];
  // complaints (جدول complaints ثنائي الاتجاه، filed_by_user_id/against_user_id) — شكاوى
  // العميل رفعها على فنيين، وشكاوى اتقالت عليه هو نفسه (مثلاً من فني).
  complaintsFiled: AdminCustomer360Complaints;
  complaintsAgainst: AdminCustomer360Complaints;
  ratingsReceived: AdminCustomer360RatingsReceived;
}

/**
 * بروفايل عميل 360° (docs/08 §35.15) — نفس فلسفة AdminTechnician360Service (§35.11) بس أخف،
 * لأن صفحة العميل الحالية (`AdminCustomerResponseDto` + كارت المحفظة) بالفعل بتغطي الفئة/
 * الإحصائيات/الإنفاق/نقاط الولاء/التقييم اللي بيدّيه/الحظر. الكارت ده بيضيف بس اللي مش موجود:
 * عناوين العميل (endpoint موجود فعلاً `GET /admin/customers/:userId/addresses` بس مش معروض
 * في الواجهة)، طلباته الحالية/القادمة، الشكاوى بالاتجاهين، والتقييم اللي *بياخده* هو (عكس اللي
 * بيدّيه، ده مش عمود محسوب أصلاً — بيتحسب هنا لايف من جدول ratings). **إعادة استخدام صريحة،
 * صفر منطق جديد**: AddressesService.findAllForUser() بالظبط زي الـendpoint الموجود. قراءة بس.
 */
@Injectable()
export class AdminCustomer360Service {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly addressesService: AddressesService,
  ) {}

  async getProfile(userId: string): Promise<AdminCustomer360Profile> {
    const [
      addresses,
      orderRows,
      filedRows,
      filedCounts,
      againstRows,
      againstCounts,
      ratingRows,
      ratingDetailRows,
    ] = await Promise.all([
      this.addressesService.findAllForUser(userId),
      this.dataSource.query<
        { order_id: string; order_number: string; order_status: string; scheduled_at: Date | null; service_name_ar: string }[]
      >(
        // orders.customer_id بيشاور على customer_profiles.id (مش users.id مباشرة) — راجع
        // infra/migrations/0007_orders.sql. لازم JOIN عبر customer_profiles.user_id.
        `SELECT o.id AS order_id, o.order_number, o.order_status, o.scheduled_at, s.name_ar AS service_name_ar
         FROM orders o
         JOIN customer_profiles cp ON cp.id = o.customer_id
         JOIN services s ON s.id = o.service_id
         WHERE cp.user_id = $1 AND o.deleted_at IS NULL AND o.order_status = ANY($2::order_status[])
         ORDER BY COALESCE(o.scheduled_at, o.created_at) ASC
         LIMIT 10`,
        [userId, CURRENT_UPCOMING_ORDER_STATUSES],
      ),
      this.dataSource.query<{ id: string; complaint_number: string; severity: string; complaint_status: string; created_at: Date }[]>(
        `SELECT id, complaint_number, severity, complaint_status, created_at FROM complaints
         WHERE filed_by_user_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId],
      ),
      this.dataSource.query<{ open_count: string; total_count: string }[]>(
        `SELECT COUNT(*) FILTER (WHERE complaint_status = 'open') AS open_count, COUNT(*) AS total_count
         FROM complaints WHERE filed_by_user_id = $1`,
        [userId],
      ),
      this.dataSource.query<{ id: string; complaint_number: string; severity: string; complaint_status: string; created_at: Date }[]>(
        `SELECT id, complaint_number, severity, complaint_status, created_at FROM complaints
         WHERE against_user_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId],
      ),
      this.dataSource.query<{ open_count: string; total_count: string }[]>(
        `SELECT COUNT(*) FILTER (WHERE complaint_status = 'open') AS open_count, COUNT(*) AS total_count
         FROM complaints WHERE against_user_id = $1`,
        [userId],
      ),
      this.dataSource.query<{ average_rating: string | null; total_count: string }[]>(
        `SELECT AVG(overall_rating) AS average_rating, COUNT(*) AS total_count
         FROM ratings WHERE rated_user_id = $1 AND rating_type = 'technician_to_customer'`,
        [userId],
      ),
      // «كل طلبية على حدة» — التقييم ده مالوش أي مسار عرض تاني: العميل مش المفروض يشوفه خالص
      // (docs/08 §68)، فالكارت ده هو المكان الوحيد اللي الأدمن يقرا منه رأي الفنيين في العميل.
      this.dataSource.query<
        { rating_id: string; order_id: string; order_number: string; overall_rating: number; comment: string | null; created_at: Date }[]
      >(
        `SELECT r.id AS rating_id, r.order_id, o.order_number, r.overall_rating, r.comment, r.created_at
         FROM ratings r
         JOIN orders o ON o.id = r.order_id
         WHERE r.rated_user_id = $1 AND r.rating_type = 'technician_to_customer'
         ORDER BY r.created_at DESC
         LIMIT 10`,
        [userId],
      ),
    ]);

    return {
      addresses: addresses.map((address) => toAddressResponseDto(address, false)),
      currentAndUpcomingOrders: orderRows.map((o) => ({
        orderId: o.order_id,
        orderNumber: o.order_number,
        orderStatus: o.order_status,
        scheduledAt: o.scheduled_at,
        serviceNameAr: o.service_name_ar,
      })),
      complaintsFiled: {
        openCount: Number(filedCounts[0]?.open_count ?? 0),
        totalCount: Number(filedCounts[0]?.total_count ?? 0),
        recent: filedRows.map((c) => ({
          id: c.id,
          complaintNumber: c.complaint_number,
          severity: c.severity,
          status: c.complaint_status,
          createdAt: c.created_at,
        })),
      },
      complaintsAgainst: {
        openCount: Number(againstCounts[0]?.open_count ?? 0),
        totalCount: Number(againstCounts[0]?.total_count ?? 0),
        recent: againstRows.map((c) => ({
          id: c.id,
          complaintNumber: c.complaint_number,
          severity: c.severity,
          status: c.complaint_status,
          createdAt: c.created_at,
        })),
      },
      ratingsReceived: {
        averageRating: ratingRows[0]?.average_rating != null ? Number(ratingRows[0].average_rating) : null,
        totalCount: Number(ratingRows[0]?.total_count ?? 0),
        recent: ratingDetailRows.map((r) => ({
          ratingId: r.rating_id,
          orderId: r.order_id,
          orderNumber: r.order_number,
          overallRating: Number(r.overall_rating),
          comment: r.comment,
          createdAt: r.created_at,
        })),
      },
    };
  }
}
