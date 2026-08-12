import { Type } from 'class-transformer';
import { IsEnum, IsLatitude, IsLongitude, IsOptional } from 'class-validator';
import { DomesticWorkerSpecialty } from '../entities/domestic-worker-profile.entity';

export class BrowseWorkersQueryDto {
  @IsOptional()
  @IsEnum(DomesticWorkerSpecialty)
  specialty?: DomesticWorkerSpecialty;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
