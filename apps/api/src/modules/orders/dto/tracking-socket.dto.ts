import { IsNumber, IsUUID, Max, Min } from 'class-validator';

export class JoinTrackingOrderDto {
  @IsUUID()
  order_id: string;
}

export class TechnicianLocationEventDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude: number;
}
