import { IsInt, Max, Min } from 'class-validator';

export class RateSupportTicketDto {
  @IsInt()
  @Min(1)
  @Max(5)
  satisfaction_rating: number;
}
