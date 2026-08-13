import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from '../technicians/technicians.service';
import { AcademyService } from './academy.service';
import { toAcademyCourseResponseDto } from './dto/academy-course-response.dto';
import { toAcademyExamAttemptResponseDto } from './dto/academy-exam-attempt-response.dto';

// اطّلاع الفني على كورسات الأكاديمية ونتايج اختباراته — base بس، مفيش شاشة apps/technician-app
// بتستخدم الـendpoints دي لسه (نفس قرار AdminAcademyController المجاور).
@Controller('academy')
@Roles(UserType.TECHNICIAN)
export class AcademyController {
  constructor(
    private readonly academyService: AcademyService,
    private readonly techniciansService: TechniciansService,
  ) {}

  @Get('courses')
  async listCourses() {
    const courses = await this.academyService.listActiveCourses();
    return courses.map(toAcademyCourseResponseDto);
  }

  @Get('my-exam-attempts')
  async myExamAttempts(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const attempts = await this.academyService.listAttemptsForTechnician(profile.id);
    return attempts.map(toAcademyExamAttemptResponseDto);
  }
}
