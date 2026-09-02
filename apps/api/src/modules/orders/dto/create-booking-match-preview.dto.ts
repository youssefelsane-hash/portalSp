import { IsIn, IsOptional, IsUUID } from "class-validator";
import { PreviewOrderDto } from "./preview-order.dto";
import { BookingMatchSelectionMode } from "../entities/booking-match-preview.entity";

export class CreateBookingMatchPreviewDto extends PreviewOrderDto {
  @IsIn(["auto", "manual"])
  selection_mode: BookingMatchSelectionMode;

  @IsOptional()
  @IsUUID()
  technician_id?: string;
}
