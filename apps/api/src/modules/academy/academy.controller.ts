import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from '../technicians/technicians.service';
import { publicQuestions } from './academy-onboarding';
import { AcademyService } from './academy.service';
import { toAcademyCourseResponseDto } from './dto/academy-course-response.dto';
import { toAcademyExamAttemptResponseDto } from './dto/academy-exam-attempt-response.dto';
import { SubmitExamAttemptDto } from './dto/submit-exam-attempt.dto';

// الأكاديمية من تطبيق الفني: الكورسات بمحتواها وأسئلتها (من غير الإجابات الصح)، الامتحان نفسه،
// وحالة الكورسات الإلزامية/إعادة التدريب (ADR-0117).
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
    return courses.map((course) => ({
      ...toAcademyCourseResponseDto(course),
      lesson_ar: course.lessonAr ?? null,
      questions: publicQuestions(course.quizQuestions ?? []),
    }));
  }

  @Get('my-exam-attempts')
  async myExamAttempts(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const attempts = await this.academyService.listAttemptsForTechnician(profile.id);
    return attempts.map(toAcademyExamAttemptResponseDto);
  }

  @Get('onboarding-status')
  async onboardingStatus(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    return this.academyService.onboardingStatus(profile.id);
  }

  // حد معقول لمحاولات حقيقية (مراجعة الدرس وإعادة المحاولة)، ويمنع تخمين الإجابات بالتكرار السريع.
  @Post('courses/:id/attempts')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async submitAttempt(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) courseId: string,
    @Body() dto: SubmitExamAttemptDto,
  ) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const { attempt, grade, onboarding } = await this.academyService.submitAttempt(profile.id, courseId, dto.answers);
    return {
      attempt: toAcademyExamAttemptResponseDto(attempt),
      score: grade.score,
      correct_count: grade.correctCount,
      total: grade.total,
      results: grade.results,
      onboarding,
    };
  }
}
