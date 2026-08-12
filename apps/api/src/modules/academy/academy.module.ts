import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { AcademyController } from './academy.controller';
import { AcademyService } from './academy.service';
import { AdminAcademyController } from './admin-academy.controller';
import { AcademyCourse } from './entities/academy-course.entity';
import { AcademyExamAttempt } from './entities/academy-exam-attempt.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AcademyCourse, AcademyExamAttempt]), AuditModule, TechniciansModule],
  controllers: [AcademyController, AdminAcademyController],
  providers: [AcademyService],
  exports: [AcademyService],
})
export class AcademyModule {}
