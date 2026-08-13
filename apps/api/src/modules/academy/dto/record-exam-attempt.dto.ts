import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class RecordExamAttemptDto {
  @IsUUID()
  technician_id: string;

  @IsUUID()
  course_id: string;

  @IsInt()
  @Min(0)
  @Max(100)
  score: number;
}
