import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  overall_rating: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  punctuality_rating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  quality_rating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  professionalism_rating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  price_fairness_rating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  cleanliness_rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  // ربط صور "بعد التنفيذ" الموجودة بالفعل (اترفعت وقت تنفيذ الطلب، order_media.media_type=
  // after_photo) مباشرة بالتقييم ده (docs/08 §9) — اختياري، مفيش رفع ملفات جديد هنا.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  after_photo_media_ids?: string[];
}
