import { EntityManager } from 'typeorm';

export interface DurableInAppNotificationInput {
  userId: string;
  notificationType: string;
  titleAr: string;
  bodyAr: string;
  orderId: string;
  deepLink: string;
}

/**
 * إشعار داخل التطبيق **مكتوب في نفس الـtransaction** بتاعة التغيير اللي بيوصفه.
 *
 * دالة خالصة بتاخد الـ`manager` كوسيط — عايشة برّه `OrdersService` (تدقيق A-1) عشان
 * مستهلكيها اتفرقوا على أكتر من فلو (إعادة الجدولة، الزيارة الفاشلة). لو فضلت دالة خاصة جوّه
 * الخدمة الكبيرة، كان أي فلو بيتفصل عنها هيضطر يعيد كتابتها.
 *
 * `delivery_status = 'sent'` صح هنا: القناة `in_app` معناها إن الصف **نفسه** هو التسليم، مفيش
 * gateway خارجي ممكن يفشل بعدين (راجع `NotificationDeliveryStatus.DELIVERED` في §21 لقنوات
 * الدفع الخارجي).
 */
export async function insertDurableInAppNotification(
  manager: EntityManager,
  input: DurableInAppNotificationInput,
): Promise<void> {
  await manager.query(
    `INSERT INTO notifications
       (user_id, notification_type, channel, title_ar, body_ar, deep_link,
        reference_type, reference_id, delivery_status, sent_at)
     VALUES ($1, $2, 'in_app', $3, $4, $5, 'order', $6, 'sent', now())`,
    [input.userId, input.notificationType, input.titleAr, input.bodyAr, input.deepLink, input.orderId],
  );
}
