import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { OrderCustomerNotice } from './entities/order-customer-notice.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from './order-state-machine';

/**
 * **قراءات الطلبات — أول شريحة من تقسيم `OrdersService`** (تدقيق A-1).
 *
 * ## المشكلة اللي الملف ده جزء من حلها
 *
 * `OrdersService` وصلت ٤٣٠٠ سطر و**٢٥ اعتمادية في الـconstructor**، لدرجة إن الكود نفسه بقى
 * فيه تعليقات بتشرح إزاي نتفادى إضافة اعتمادية جديدة («آخر بند عمدًا… عشان ياخد أقل بلاست-رديوس
 * ممكن على الاختبارات»). لما بنية الاختبار تفرض ترتيب الـconstructor، ده مش تفضيل — ده coupling.
 *
 * أوضح دليل عملي: `OrderTrackingGateway` كان محتاج **دالتين** بيلمسوا الـrepository بس، وعشان
 * كده كان لازم يبني `OrdersService` بـ**٢٣ وسيط `{} as never`**.
 *
 * ## القاعدة اللي بتحكم الملف ده
 *
 * الشريحة دي **قراءات بحتة**: مفيش كتابة، مفيش حدث، مفيش transaction. اعتمادياتها **أربعة** بس،
 * وكلها لازمة فعلاً:
 *
 * | الاعتمادية | ليه |
 * |------------|-----|
 * | `Repository<Order>` | الاستعلام نفسه |
 * | `DataSource` | كيانات مقروءة على المسار ده بس (`OrderCustomerNotice`) |
 * | `CustomerProfilesService` | `userId` ⇒ `customer_id` |
 * | `TechniciansService` | `userId` ⇒ `technician_profile_id` |
 *
 * `OrdersService` بتفوّض لها وبتحافظ على نفس التوقيعات العامة بالحرف — يعني كل المنادين
 * (controllers، gateways، ٢٥ spec بتبني الخدمة يدويًا) مالهمش أي تغيير.
 */
@Injectable()
export class OrderQueriesService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
  ) {}

  findAllForCustomerUser(userId: string): Promise<Order[]> {
    return this.customerProfiles.findByUserIdOrThrow(userId).then((profile) =>
      this.orders.find({ where: { customerId: profile.id }, order: { createdAt: 'DESC' } }),
    );
  }

  /**
   * رسايل الإدارة للعميل على الطلب (ADR-0071) — الأحدث الأول.
   *
   * بتتنادى من مسار **تفاصيل الطلب** بس، مش من القوايم: استعلام لكل صف في قايمة بيكلّف N+1 مقابل
   * معلومة مالهاش مكان في كارت القايمة أصلاً.
   */
  listCustomerNotices(orderId: string): Promise<OrderCustomerNotice[]> {
    return this.dataSource.getRepository(OrderCustomerNotice).find({
      where: { orderId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }


  async findOneOwnedOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, customerId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  async findOwnedByTechnicianOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return order;
  }


  /**
   * (docs/08 §31) — للقراءة بس (تفاصيل الطلب + قايمة أعضاء الفريق)، مش لأي فعل تنفيذي. عضو فريق
   * مُضاف (order_team_members، مش قائد الطلب) عنده حق يشوف الطلب دلوقتي — بَقّة حقيقية كانت هنا:
   * findOwnedByTechnicianOrThrow() القديمة كانت بترفض 404 لعضو الفريق نفسه، فمكانش يقدر أصلاً
   * يشوف تفاصيل شغلانة اتضاف ليها. أفعال التنفيذ (depart/arrive/start/complete/cancel) لسه
   * findOwnedByTechnicianOrThrow بس (القائد وحده) — نفس فلسفة "عضو فريق عادي ميقدرش يلغي بنفسه".
   */
  async findVisibleForTechnician(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    if (order.technicianId === profile.id) {
      return order;
    }
    const [membership] = await this.orders.manager.query<{ id: string }[]>(
      `SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2 LIMIT 1`,
      [orderId, profile.id],
    );
    if (!membership) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return order;
  }


  /** "شغلي كعضو فريق" (docs/08 §31) — عكس findActiveForTechnician() بالظبط: طلبات الفني قائدها فيها فني تاني، وهو بس مضاف كعضو. */
  async listTeamAssignedForTechnician(userId: string): Promise<Order[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    // استعلام خام لمعرّفات الطلبات بس (بلا hydration) — الجلب الفعلي عبر repository.find() تحت
    // عشان يرجّع كيانات Order مربوطة صح (camelCase)، مش صفوف خام (snake_case) هتكسر toOrderResponseDto.
    const rows = await this.orders.manager.query<{ order_id: string }[]>(
      `SELECT DISTINCT otm.order_id FROM order_team_members otm
       JOIN orders o ON o.id = otm.order_id
       WHERE otm.technician_id = $1 AND o.order_status = ANY($2::order_status[]) AND o.deleted_at IS NULL`,
      [profile.id, ACTIVE_TECHNICIAN_ORDER_STATUSES],
    );
    if (rows.length === 0) return [];
    return this.orders.find({
      where: { id: In(rows.map((r) => r.order_id)) },
      order: { updatedAt: 'DESC' },
    });
  }

  async findActiveOrdersForTechnician(userId: string): Promise<Order[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.orders.find({
      where: [
        { technicianId: profile.id, orderStatus: In(ACTIVE_TECHNICIAN_ORDER_STATUSES), scheduledAt: IsNull() },
        { technicianId: profile.id, orderStatus: In(ENGAGED_TECHNICIAN_ORDER_STATUSES) },
      ],
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * توافق خلفي للنسخ القديمة من تطبيق الفني: المسار القديم بيرجّع طلب واحد فقط. المصدر الحقيقي
   * بقى القائمة فوق، عشان الطلبات المتزامنة ما تختفيش من النسخ الجديدة.
   */
  async findActiveForTechnician(userId: string): Promise<Order | null> {
    const orders = await this.findActiveOrdersForTechnician(userId);
    return orders[0] ?? null;
  }

  /**
   * الطلبات اللي الفني **في طريقه ليها فعليًا دلوقتي** — المصدر الوحيد اللي بث الموقع اللحظي
   * (`OrderTrackingGateway.handleLocation`) بيعتمد عليه.
   *
   * **ليه `TECHNICIAN_ON_WAY` بس، مش كل الحالات النشطة؟** التتبّع اللحظي ليه معنى واحد: «الفني
   * جاي، هو فين دلوقتي». بعد `TECHNICIAN_ARRIVED` الفني واقف عند عنوان العميل نفسه، وبعد
   * `IN_PROGRESS` هو بيشتغل جوّه البيت — بث إحداثياته وقتها **تسريب خصوصية بلا أي فايدة** (العميل
   * عارف هو فين، هو عنده). فالنطاق الأضيق هنا مش تقييد، ده التعريف الصح.
   *
   * **وليه قايمة مش `findOne`؟** ADR-0070 فتح للفني إنه يمسك أكتر من طلب نشط في نفس اليوم. الكود
   * القديم كان `findOne` **بلا `ORDER BY`** على مجموعة ممكن ترجّع أكتر من صف، يعني Postgres
   * بيختار صف بالعشوائي (حسب خطة التنفيذ) — فعميل الطلب A كان ممكن يشوف الفني بيتحرّك وهو رايح
   * لـB، أو مايشوفش حاجة خالص. القايمة بترتيب حتمي بتشيل العشوائية من أصلها: البث بيروح لكل غرفة
   * الفني فعلاً في طريقه ليها.
   *
   * بياخد **معرّف بروفايل الفني** (مش `userId`) لأن المنادي الوحيد (الـgateway) عنده البروفايل
   * أصلاً — تفادي استعلام زيادة على كل تحديث موقع (بيوصل ١٠ في الـ١٠ ثواني لكل فني).
   */
  async findOrdersInTransitForTechnician(technicianProfileId: string): Promise<Order[]> {
    return this.orders.find({
      where: { technicianId: technicianProfileId, orderStatus: OrderStatus.TECHNICIAN_ON_WAY },
      order: { scheduledAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * «الفني ده على الطلب ده؟» — قائدًا أو عضو طاقم. المصدر الوحيد لسؤال الانتماء ده.
   *
   * كان كل مستهلك بيسأله بطريقته: `order.technicianId === profile.id` بس (الـgateway)، أو
   * `order_team_members` بس (`listTeamAssignedForTechnician`). النتيجة إن عضو الطاقم في طلب فريق
   * كان بياخد «الطلب ده مش بتاعك» لما يحاول يتابع الطلب اللي هو نفسه شغّال عليه.
   *
   * `orders.technician_id` = القائد، و`order_team_members` = باقي الطاقم (مساعدين وأعضاء) —
   * الاتنين مع بعض هما «طاقم الطلب» الكامل.
   */
  async isTechnicianAssignedToOrder(technicianProfileId: string, order: Order): Promise<boolean> {
    if (order.technicianId === technicianProfileId) return true;
    const [row] = await this.orders.manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS(
         SELECT 1 FROM order_team_members
         WHERE order_id = $1 AND technician_id = $2
       ) AS exists`,
      [order.id, technicianProfileId],
    );
    return row?.exists === true;
  }

  /**
   * مقارنة "يوم الجدولة" بيوم النهاردة **بتوقيت مصر**، في SQL مباشرة (الجدولة باليوم مش بالساعة،
   * ADR-0018 §2). عمداً مش بحساب حدود اليوم في JS: أول نسخة هنا كانت بتحسب بداية اليوم بـ
   * `toLocaleString('en-US', {timeZone:'Africa/Cairo'})` + `setHours(0,0,0,0)` — وده بياخد
   * **تاريخ** القاهرة ويحط عليه منتصف ليل **توقيت السيرفر** (UTC عادة)، يعني بيطلع 03:00 بتوقيت
   * القاهرة. النتيجة بَقّة حقيقية اتلقطت في الاختبار الحي: في أول 3 ساعات من كل يوم مصري، شغل
   * النهاردة كان بيتحسب "متأخر" ويختفي من "قدامك". نفس تعبير الـSQL المستخدم في
   * `technician-eligibility.sql.ts` و`admin-exception-center.service.ts` بالحرف — تعريف واحد.
   */
  private static readonly CAIRO_DAY_EXPR = `(o.scheduled_at AT TIME ZONE 'Africa/Cairo')::date`;
  private static readonly CAIRO_TODAY_EXPR = `(now() AT TIME ZONE 'Africa/Cairo')::date`;

  /**
   * "شغل متأخر" (docs/08 §56 بند 4) — شغلانة اتقبلت، يوم تنفيذها عدّى، والفني **لسه ما بدأش
   * يتحرّك ليها** (`ACCEPTED` بالظبط، مش أي حالة تنفيذ). دي كانت بتختفي من كل الشاشات: مش
   * "قدامك" (موعدها فات) ومش "حالي" غير لو الصدفة رجّعتها. لازم تبان بوضوح — وباللون الأحمر.
   */
  async findOverdueForTechnician(userId: string): Promise<Order[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.orders
      .createQueryBuilder('o')
      .where('o.technician_id = :technicianId', { technicianId: profile.id })
      .andWhere('o.order_status = :status', { status: OrderStatus.ACCEPTED })
      .andWhere('o.scheduled_at IS NOT NULL')
      .andWhere(`${OrderQueriesService.CAIRO_DAY_EXPR} < ${OrderQueriesService.CAIRO_TODAY_EXPR}`)
      .orderBy('o.scheduled_at', 'ASC')
      .getMany();
  }

  // "الشغل المؤكّد قدامي" (docs/08 §165) — عكس findActiveForTechnician() بالظبط: الطلبات
  // المجدولة اللي اتأكّدت تلقائيًا (autoConfirmScheduledOrder()) بس لسه معاداش موعدها، عشان
  // apps/technician-app يعرضها كقايمة منفصلة ("شغل قادم مؤكّد") مش يخلطها مع "طلبات محتاجة قرارك".
  async findUpcomingConfirmedForTechnician(userId: string): Promise<Order[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    // بَقّة حقيقية (docs/08 §56 بند 4): كانت `MoreThan(now)` — يعني شغل **النهاردة** بيختفي من
    // القايمة أول ما اليوم يبدأ (`scheduled_at` = بداية اليوم بالظبط بعد ADR-0018 §2، فهي أصغر
    // من `now` دايمًا). الفني كان بيصحى يلاقي شغل النهاردة مش موجود في "قدامك". الحد الصح هو
    // **بداية النهاردة** مش اللحظة الحالية.
    return this.orders
      .createQueryBuilder('o')
      .where('o.technician_id = :technicianId', { technicianId: profile.id })
      // بمجرد ما الفني يبدأ التحرك، الطلب ينتقل لقسم "الشغل الحالي" حتى لو كان مجدولًا؛ إبقاؤه
      // هنا كان يعرض نفس الطلب مرتين. القادم المؤكد هو المقبول الذي لم يبدأ تنفيذه فقط.
      .andWhere('o.order_status = :status', { status: OrderStatus.ACCEPTED })
      .andWhere('o.scheduled_at IS NOT NULL')
      .andWhere(`${OrderQueriesService.CAIRO_DAY_EXPR} >= ${OrderQueriesService.CAIRO_TODAY_EXPR}`)
      .orderBy('o.scheduled_at', 'ASC')
      .getMany();
  }
}
