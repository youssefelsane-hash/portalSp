import { ArrayMinSize, IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class LngLatPoint {
  @IsNumber()
  lng: number;

  @IsNumber()
  lat: number;
}

// حلقة مضلّع بسيطة (بدون ثقوب) — [lng, lat] زي GeoJSON. لازم 4 نقط على الأقل (مثلث مقفول:
// أول نقطة == آخر نقطة) — لو مش مقفولة بنقفلها تلقائياً في الـ service بدل ما نرفض الطلب.
export class SetServiceZoneBoundaryDto {
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => LngLatPoint)
  points: LngLatPoint[];
}
