import { IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class RedeemLoyaltyPointsDto {
  @IsInt()
  @IsPositive()
  points: number;

  // مرجع اختياري (مثلاً order_id) للربط السياقي بس — مفيش تحويل تلقائي للنقاط لخصم فعلي على
  // الطلب هنا، القاموس مالوش سعر صرف محدد للنقطة فمش هنخترعه (نفس قرار earn الموثّق فوق).
  @IsOptional()
  @IsUUID()
  reference_id?: string;
}
