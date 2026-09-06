import { Logger } from '@nestjs/common';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { Order } from './entities/order.entity';

/**
 * **طلب واحد بايظ مايفضّيش شاشة الفني كلها.**
 *
 * بلاغ مالك (2026-09-06، تلات لقطات بتلات أكواد أخطاء مختلفة): «جزء من الشاشة ما اتحمّلش…
 * بدوس إعادة المحاولة، مفيش فايدة… الفني مش عارف يستخدم الموبايل بتاعه».
 *
 * السبب البنيوي: `Promise.all` بترمي من **أول** عنصر بيفشل. فطلب واحد بيانات مرجعية ناقصة
 * (عنوان اتمسح، خدمة اتشالت، صف مالي مش متوقّع) كان بيحوّل القايمة كلها لـ500 — والفني بيلاقي
 * شريط أحمر وصفر شغلانات، حتى لو باقي شغله تمام.
 */
describe('صمود قوايم الفني — طلب بايظ بيتشال مش بيكسر القايمة', () => {
  function buildController(failing: Set<string>): {
    controller: TechnicianOrderExecutionController;
    errors: string[];
  } {
    const errors: string[] = [];
    const controller = Object.create(
      TechnicianOrderExecutionController.prototype,
    ) as TechnicianOrderExecutionController;
    Object.assign(controller, {
      logger: { error: (msg: string) => errors.push(msg) } as unknown as Logger,
      toDto: async (order: Order) => {
        if (failing.has(order.orderNumber)) throw new Error(`بيانات ناقصة في ${order.orderNumber}`);
        return { order_number: order.orderNumber };
      },
    });
    return { controller, errors };
  }

  const orders = (...numbers: string[]): Order[] =>
    numbers.map((orderNumber) => ({ orderNumber }) as Order);

  const listOf = (
    controller: TechnicianOrderExecutionController,
    rows: Order[],
  ): Promise<{ order_number: string }[]> =>
    (
      controller as unknown as {
        toDtoListResilient(o: Order[]): Promise<{ order_number: string }[]>;
      }
    ).toDtoListResilient(rows);

  it('الطلب البايظ بيتشال والباقي بيوصل — مش القايمة كلها بتقع', async () => {
    const { controller, errors } = buildController(new Set(['ORD-2']));
    const result = await listOf(controller, orders('ORD-1', 'ORD-2', 'ORD-3'));

    expect(result.map((r) => r.order_number)).toEqual(['ORD-1', 'ORD-3']);
    // الفشل مابيتبلعش: بيتسجّل برقم الطلب عشان يتصلح من جذره.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ORD-2');
  });

  it('كل الطلبات بايظة = قايمة فاضية، مش 500', async () => {
    const { controller, errors } = buildController(new Set(['ORD-1', 'ORD-2']));
    await expect(listOf(controller, orders('ORD-1', 'ORD-2'))).resolves.toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it('مفيش أي فشل = نفس السلوك القديم بالحرف', async () => {
    const { controller, errors } = buildController(new Set());
    const result = await listOf(controller, orders('ORD-1', 'ORD-2'));
    expect(result.map((r) => r.order_number)).toEqual(['ORD-1', 'ORD-2']);
    expect(errors).toHaveLength(0);
  });
});
