import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreateAcademyCourseDto } from './dto/create-academy-course.dto';
import { RecordExamAttemptDto } from './dto/record-exam-attempt.dto';
import { UpdateAcademyCourseDto } from './dto/update-academy-course.dto';
import { AcademyExamAttempt } from './entities/academy-exam-attempt.entity';
import { AcademyCourse } from './entities/academy-course.entity';

@Injectable()
export class AcademyService {
  constructor(
    @InjectRepository(AcademyCourse) private readonly courses: Repository<AcademyCourse>,
    @InjectRepository(AcademyExamAttempt) private readonly attempts: Repository<AcademyExamAttempt>,
    private readonly auditLog: AuditLogService,
  ) {}

  listActiveCourses(): Promise<AcademyCourse[]> {
    return this.courses.find({ where: { isActive: true }, order: { displayOrder: 'ASC' } });
  }

  listAllCoursesForAdmin(): Promise<AcademyCourse[]> {
    return this.courses.find({ order: { displayOrder: 'ASC' } });
  }

  async findCourseOrThrow(id: string): Promise<AcademyCourse> {
    const course = await this.courses.findOne({ where: { id } });
    if (!course) {
      throw new ApiException(ErrorCode.VAL_001, 'كورس الأكاديمية غير موجود', HttpStatus.NOT_FOUND);
    }
    return course;
  }

  async createCourse(adminUserId: string, dto: CreateAcademyCourseDto, meta?: AuditActorMeta): Promise<AcademyCourse> {
    const course = this.courses.create({
      titleAr: dto.title_ar,
      titleEn: dto.title_en,
      descriptionAr: dto.description_ar ?? null,
      passingScore: dto.passing_score ?? 70,
      displayOrder: dto.display_order ?? 0,
      isActive: dto.is_active ?? true,
    });
    await this.courses.save(course);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'academy_course.created',
      entityType: 'academy_course',
      entityId: course.id,
      newValues: { title_ar: course.titleAr },
      meta,
    });
    return course;
  }

  async updateCourse(
    adminUserId: string,
    id: string,
    dto: UpdateAcademyCourseDto,
    meta?: AuditActorMeta,
  ): Promise<AcademyCourse> {
    const course = await this.findCourseOrThrow(id);
    const oldValues = { is_active: course.isActive, passing_score: course.passingScore };

    if (dto.title_ar !== undefined) course.titleAr = dto.title_ar;
    if (dto.title_en !== undefined) course.titleEn = dto.title_en;
    if (dto.description_ar !== undefined) course.descriptionAr = dto.description_ar;
    if (dto.passing_score !== undefined) course.passingScore = dto.passing_score;
    if (dto.display_order !== undefined) course.displayOrder = dto.display_order;
    if (dto.is_active !== undefined) course.isActive = dto.is_active;
    await this.courses.save(course);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'academy_course.updated',
      entityType: 'academy_course',
      entityId: course.id,
      oldValues,
      newValues: { is_active: course.isActive, passing_score: course.passingScore },
      meta,
    });
    return course;
  }

  // النجاح بيتحسب من passing_score بتاع الكورس نفسه وقت التسجيل — مش قيمة بيبعتها الأدمن يدويًا،
  // عشان مفيش تضارب لو حد غيّر passing_score الكورس بعد كده والمحاولات القديمة تفضل صحيحة تاريخيًا.
  async recordExamAttempt(adminUserId: string, dto: RecordExamAttemptDto, meta?: AuditActorMeta): Promise<AcademyExamAttempt> {
    const course = await this.findCourseOrThrow(dto.course_id);

    const attempt = this.attempts.create({
      technicianId: dto.technician_id,
      courseId: dto.course_id,
      score: dto.score,
      passed: dto.score >= course.passingScore,
      recordedByUserId: adminUserId,
      attemptedAt: new Date(),
    });
    await this.attempts.save(attempt);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'academy_exam_attempt.recorded',
      entityType: 'academy_exam_attempt',
      entityId: attempt.id,
      newValues: { technician_id: attempt.technicianId, course_id: attempt.courseId, score: attempt.score, passed: attempt.passed },
      meta,
    });
    return attempt;
  }

  listAttemptsForTechnician(technicianId: string): Promise<AcademyExamAttempt[]> {
    return this.attempts.find({ where: { technicianId }, order: { attemptedAt: 'DESC' } });
  }
}
