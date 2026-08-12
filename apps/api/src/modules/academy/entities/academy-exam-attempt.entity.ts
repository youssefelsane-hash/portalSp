import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TechnicianProfile } from '../../technicians/entities/technician-profile.entity';
import { User } from '../../auth/entities/user.entity';
import { AcademyCourse } from './academy-course.entity';

@Entity('academy_exam_attempts')
export class AcademyExamAttempt {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @ManyToOne(() => TechnicianProfile)
  @JoinColumn({ name: 'technician_id' })
  technician: TechnicianProfile;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId: string;

  @ManyToOne(() => AcademyCourse)
  @JoinColumn({ name: 'course_id' })
  course: AcademyCourse;

  @Column({ type: 'smallint' })
  score: number;

  @Column({ type: 'boolean' })
  passed: boolean;

  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'recorded_by_user_id' })
  recordedByUser: User | null;

  @Column({ name: 'attempted_at', type: 'timestamptz' })
  attemptedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
