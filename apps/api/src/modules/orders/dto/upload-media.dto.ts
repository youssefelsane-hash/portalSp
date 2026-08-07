import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderMediaType } from '../entities/order-media.entity';

export class UploadMediaDto {
  @IsEnum(OrderMediaType)
  media_type: OrderMediaType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  caption?: string;
}
