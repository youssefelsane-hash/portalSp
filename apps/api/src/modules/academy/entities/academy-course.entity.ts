import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** `correct_index` مابيطلعش من السيرفر أبدًا — التصحيح هنا بس (ADR-0117). */
export interface AcademyQuizQuestion {
  id: string;
  prompt_ar: string;
  options_ar: string[];
  correct_index: number;
}

@Entity('academy_courses')
export class AcademyCourse {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'title_ar', type: 'varchar', length: 200 })
  titleAr: string;

  @Column({ name: 'title_en', type: 'varchar', length: 200 })
  titleEn: string;

  @Column({ name: 'description_ar', type: 'text', nullable: true })
  descriptionAr: string | null;

  @Column({ name: 'passing_score', type: 'smallint', default: 70 })
  passingScore: number;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

  // ADR-0117 — محتوى الكورس والاختبار على نفس الصف (مفيش منصة تدريب منفصلة).
  @Column({ name: 'course_key', type: 'varchar', length: 60, nullable: true })
  courseKey: string | null;

  @Column({ name: 'lesson_ar', type: 'text', nullable: true })
  lessonAr: string | null;

  @Column({ name: 'quiz_questions', type: 'jsonb', default: () => `'[]'::jsonb` })
  quizQuestions: AcademyQuizQuestion[];

  @Column({ name: 'is_mandatory_onboarding', type: 'boolean', default: false })
  isMandatoryOnboarding: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
