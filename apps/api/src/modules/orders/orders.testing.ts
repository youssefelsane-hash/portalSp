import { DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';

/**
 * `OrdersService` مبنيّة بالحد الأدنى اللي `OrderTrackingGateway` بيحتاجه فعلاً.
 *
 * **ليه موجودة**: الـgateway بقى بيسأل الخدمة عن حاجتين (`isTechnicianAssignedToOrder`،
 * `findOrdersInTransitForTechnician`) — الاتنين مابيلمسوش غير الـrepository ومديره. تمرير stub
 * بـ`jest.fn()` كان هيخلّي اختبارات الـgateway تختبر الـstub مش المنطق اللي اتكتب، فالحل إننا
 * نبني الخدمة الحقيقية بنفس النمط المختصر المتّبع في specs الموديول (`{} as never` لكل اعتمادية
 * مش مستخدمة في المسار ده).
 *
 * **ملاحظة معمارية صريحة** (نتيجة تدقيق A-1): إن بناء الخدمة محتاج ٢٣+ وسيط عشان دالتين
 * بيستخدموا واحد بس هو نفسه الدليل على إن `OrdersService` كبرت أكتر من اللازم. الملف ده بيعزل
 * الألم في مكان واحد بدل ما يتكرر في كل spec، لحد ما التقسيم بالفلو يتعمل.
 */
export function ordersServiceForGateway(dataSource: DataSource): OrdersService {
  return new OrdersService(
    dataSource.getRepository(Order),
    {} as never,
    {} as never,
    dataSource,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}
