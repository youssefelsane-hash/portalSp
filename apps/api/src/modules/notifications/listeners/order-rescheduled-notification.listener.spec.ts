import { OrderRescheduledEvent } from "../../../common/events/order-rescheduled.event";
import { NotificationChannel } from "../entities/notification.entity";
import { OrderRescheduledNotificationListener } from "./order-rescheduled-notification.listener";

describe("OrderRescheduledNotificationListener", () => {
  const makeListener = () => {
    const notifyMultiChannel = jest.fn().mockResolvedValue(undefined);
    const listener = new OrderRescheduledNotificationListener(
      {
        findByProfileIdOrThrow: jest
          .fn()
          .mockResolvedValue({ userId: "technician-user" }),
      } as never,
      {
        findByProfileIdOrThrow: jest
          .fn()
          .mockResolvedValue({ userId: "customer-user" }),
      } as never,
      { notifyMultiChannel } as never,
    );
    return { listener, notifyMultiChannel };
  };

  it("تغيير الأدمن يبلغ الفني والعميل، والعميل يأخذ Push فقط بعد كتابة in-app داخل transaction", async () => {
    const { listener, notifyMultiChannel } = makeListener();
    const event = new OrderRescheduledEvent(
      "order-id",
      "ORD-2026-000123",
      "technician-profile",
      "customer-profile",
      new Date("2026-08-27T00:00:00Z"),
      new Date("2026-08-30T00:00:00Z"),
      "admin",
      false,
      true,
    );

    await listener.handle(event);

    expect(notifyMultiChannel).toHaveBeenCalledTimes(2);
    expect(notifyMultiChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "technician-user",
        referenceId: "order-id",
      }),
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
    );
    expect(notifyMultiChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "customer-user",
        notificationType: "order_rescheduled",
        deepLink: "/orders/order-id",
      }),
      [NotificationChannel.PUSH],
    );
  });

  it("تغيير العميل بنفسه لا يرسل له إشعارًا زائدًا", async () => {
    const { listener, notifyMultiChannel } = makeListener();

    await listener.handle(
      new OrderRescheduledEvent(
        "order-id",
        "ORD-2026-000124",
        "technician-profile",
        "customer-profile",
        null,
        new Date("2026-09-01T00:00:00Z"),
        "customer",
      ),
    );

    expect(notifyMultiChannel).toHaveBeenCalledTimes(1);
    expect(notifyMultiChannel.mock.calls[0][0].userId).toBe("technician-user");
  });

  it("فشل قناة لطرف لا يمنع محاولة إشعار الطرف الآخر ولا يكسر العملية الأصلية", async () => {
    const notifyMultiChannel = jest
      .fn()
      .mockRejectedValueOnce(new Error("technician push unavailable"))
      .mockResolvedValueOnce(undefined);
    const listener = new OrderRescheduledNotificationListener(
      {
        findByProfileIdOrThrow: jest
          .fn()
          .mockResolvedValue({ userId: "technician-user" }),
      } as never,
      {
        findByProfileIdOrThrow: jest
          .fn()
          .mockResolvedValue({ userId: "customer-user" }),
      } as never,
      { notifyMultiChannel } as never,
    );

    await expect(
      listener.handle(
        new OrderRescheduledEvent(
          "order-id",
          "ORD-2026-000125",
          "technician-profile",
          "customer-profile",
          null,
          new Date("2026-09-02T00:00:00Z"),
          "admin",
        ),
      ),
    ).resolves.toBeUndefined();
    expect(notifyMultiChannel).toHaveBeenCalledTimes(2);
  });
});
