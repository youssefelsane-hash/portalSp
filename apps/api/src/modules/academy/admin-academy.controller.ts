import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AcademyService } from './academy.service';
import { toAcademyCourseResponseDto } from './dto/academy-course-response.dto';
import { toAcademyExamAttemptResponseDto } from './dto/academy-exam-attempt-response.dto';
import { CreateAcademyCourseDto } from './dto/create-academy-course.dto';
import { RecordExamAttemptDto } from './dto/record-exam-attempt.dto';
import { UpdateAcademyCourseDto } from './dto/update-academy-course.dto';

// إدارة "الأكاديمية" من الأدمن — base بس (migration 0072، تفاصيل القرار في README.md المجاور).
// مفيش شاشة أدمن بتستخدم الـendpoints دي لسه — تسجيل الكورسات/نتائج الاختبار يدوي عبر الـAPI مباشرة
// (curl/Postman) لحد ما الأولوية تيجي تُبنى شاشة (المالك نفسه طلب الموضوع ده يفضل base بس دلوقتي).
@Controller('admin/academy')
@Roles(UserType.ADMIN)
export class AdminAcademyController {
  constructor(private readonly academyService: AcademyService) {}

  @Get('courses')
  async listCourses() {
    const courses = await this.academyService.listAllCoursesForAdmin();
    return courses.map(toAcademyCourseResponseDto);
  }

  @Post('courses')
  @RequirePermission('academy.manage')
  async createCourse(@CurrentUser() admin: JwtPayload, @Body() dto: CreateAcademyCourseDto, @AuditContext() audit: AuditMeta) {
    return toAcademyCourseResponseDto(await this.academyService.createCourse(admin.sub, dto, audit));
  }

  @Patch('courses/:id')
  @RequirePermission('academy.manage')
  async updateCourse(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcademyCourseDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAcademyCourseResponseDto(await this.academyService.updateCourse(admin.sub, id, dto, audit));
  }

  @Post('exam-attempts')
  @RequirePermission('academy.manage')
  async recordExamAttempt(@CurrentUser() admin: JwtPayload, @Body() dto: RecordExamAttemptDto, @AuditContext() audit: AuditMeta) {
    return toAcademyExamAttemptResponseDto(await this.academyService.recordExamAttempt(admin.sub, dto, audit));
  }

  @Get('technicians/:technicianId/exam-attempts')
  async listAttemptsForTechnician(@Param('technicianId', ParseUUIDPipe) technicianId: string) {
    const attempts = await this.academyService.listAttemptsForTechnician(technicianId);
    return attempts.map(toAcademyExamAttemptResponseDto);
  }
}
