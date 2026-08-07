import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];
}
