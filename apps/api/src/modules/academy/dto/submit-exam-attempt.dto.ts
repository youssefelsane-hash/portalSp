import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

/** رقم الاختيار لكل سؤال بنفس ترتيب الأسئلة (ADR-0117). التصحيح في السيرفر. */
export class SubmitExamAttemptDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(9, { each: true })
  answers: number[];
}
