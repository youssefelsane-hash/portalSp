import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * تأكيد استلام من الجهاز (تدقيق L-7). دفعة مش واحد عمدًا: الجهاز اللي كان مقفول ساعات بيستقبل
 * كذا إشعار مرة واحدة أول ما يفتح، فطلب لكل واحد = ضجيج شبكة بلا فايدة.
 */
export class MarkNotificationsDeliveredDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  notification_ids: string[];
}
