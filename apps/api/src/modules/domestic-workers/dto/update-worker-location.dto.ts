import { IsLatitude, IsLongitude } from 'class-validator';

export class UpdateWorkerLocationDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
