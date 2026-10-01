import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CreateAcademyCourseDto } from './create-academy-course.dto';

export class AcademyQuizQuestionUpdateDto {
  @IsString()
  @Length(1, 60)
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  prompt_ar: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(300, { each: true })
  options_ar: string[];

  @IsInt()
  @Min(0)
  @Max(5)
  correct_index: number;
}

export class UpdateAcademyCourseDto extends PartialType(CreateAcademyCourseDto) {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AcademyQuizQuestionUpdateDto)
  quiz_questions?: AcademyQuizQuestionUpdateDto[];
}
