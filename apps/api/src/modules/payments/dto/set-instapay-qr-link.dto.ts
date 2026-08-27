import { IsString, MaxLength } from 'class-validator';

export class SetInstaPayQrLinkDto {
  // التحقق من كون الرابط https بيتم في `InstaPayQrService.setLink` — الفحص ده أمني مش شكلي
  // (صورة QR مبدّلة في الطريق = فلوس العميل بتروح لحساب تاني)، فمكانه مع باقي منطق الخدمة
  // عشان يفضل مطبّق حتى لو اتنادت من مسار تاني بعدين.
  @IsString()
  @MaxLength(2000)
  url: string;
}
