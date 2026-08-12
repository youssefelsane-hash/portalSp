import { PartialType } from '@nestjs/mapped-types';
import { CreateAcademyCourseDto } from './create-academy-course.dto';

export class UpdateAcademyCourseDto extends PartialType(CreateAcademyCourseDto) {}
