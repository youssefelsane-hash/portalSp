import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { OrderSourceChannel } from '../../orders/entities/order.entity';
import { FunnelStage } from '../entities/booking-funnel-event.entity';

/**
 * **المراحل الوحيدة المسموح للكلاينت يسجّلها** — اللي مالهاش نداء سيرفر أصلاً.
 *
 * الباقي (`price_previewed`, `providers_viewed`, `order_placed`) بيتسجّل سيرفر-سايد من
 * `OrdersController` لأن وراه فعل حقيقي. قبولها من الكلاينت كان بيسمح بنفخ الفنل — وتحديدًا
 * نفخ المراحل الأخيرة، فالفلو المكسور يبان سليم. القايمة دي هي الحارس.
 */
export const CLIENT_TRACKABLE_STAGES: FunnelStage[] = ['service_viewed', 'booking_started'];

export class TrackClientFunnelEventDto {
  @IsIn(CLIENT_TRACKABLE_STAGES)
  stage: FunnelStage;

  @IsOptional()
  @IsUUID()
  service_id?: string;

  @IsOptional()
  @IsUUID()
  city_id?: string;

  /** من فين جه الحدث — بيخلّي «الويب بيسرّب أكتر من التطبيق» سؤال ليه إجابة. */
  @IsOptional()
  @IsEnum(OrderSourceChannel)
  channel?: OrderSourceChannel;
}
