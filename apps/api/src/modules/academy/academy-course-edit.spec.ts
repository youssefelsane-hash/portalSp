import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { publicQuestions, gradeQuiz } from './academy-onboarding';
import { AcademyService } from './academy.service';
import { AdminAcademyController } from './admin-academy.controller';
import { toAcademyCourseResponseDto, toAdminAcademyCourseEditResponseDto } from './dto/academy-course-response.dto';
import { UpdateAcademyCourseDto } from './dto/update-academy-course.dto';
import { AcademyCourse, AcademyQuizQuestion } from './entities/academy-course.entity';

const originalQuestions: AcademyQuizQuestion[] = [
  { id: 'q1', prompt_ar: 'السؤال الأول', options_ar: ['صحيح', 'خطأ', 'ربما'], correct_index: 0 },
  { id: 'q2', prompt_ar: 'السؤال الثاني', options_ar: ['أ', 'ب', 'ج'], correct_index: 1 },
];

function fixture() {
  const course = Object.assign(new AcademyCourse(), {
    id: '00000000-0000-0000-0000-000000000001',
    titleAr: 'الكورس الإلزامي',
    titleEn: 'Mandatory course',
    descriptionAr: null,
    passingScore: 80,
    displayOrder: 0,
    isActive: true,
    courseKey: 'conduct',
    isMandatoryOnboarding: true,
    quizQuestions: structuredClone(originalQuestions),
  });
  const findOne = jest.fn(async () => course);
  const save = jest.fn(async (value: AcademyCourse) => value);
  const saveAttempt = jest.fn();
  const record = jest.fn(async () => undefined);
  const service = new AcademyService({ findOne, save } as never, { save: saveAttempt } as never, { record } as never, {} as never);
  return { course, service, save, saveAttempt, record };
}

describe('Admin academy question editing', () => {
  it('only academy.manage may read the correct answers', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, AdminAcademyController.prototype.getCourseForEditing)).toBe('academy.manage');
    const { course } = fixture();
    expect(toAdminAcademyCourseEditResponseDto(course).quiz_questions[0].correct_index).toBe(0);
    expect(JSON.stringify(toAcademyCourseResponseDto(course))).not.toContain('correct_index');
    expect(JSON.stringify(publicQuestions(course.quizQuestions))).not.toContain('correct_index');
  });

  it('accepts a complete quiz edit and grades future attempts without changing past scores', async () => {
    const { course, service, save, saveAttempt, record } = fixture();
    const oldAttempt = { score: gradeQuiz(course.quizQuestions, [0, 1]).score, passed: true };
    const edited = structuredClone(course.quizQuestions);
    edited[0].prompt_ar = 'صياغة جديدة للسؤال الأول';
    edited[0].options_ar[1] = 'اختيار معدل';
    edited[0].correct_index = 1;

    const updated = await service.updateCourse('admin-id', course.id, { quiz_questions: edited });

    expect(save).toHaveBeenCalledTimes(1);
    expect(updated.quizQuestions[0]).toEqual(edited[0]);
    expect(publicQuestions(updated.quizQuestions)[0].prompt_ar).toBe('صياغة جديدة للسؤال الأول');
    expect(JSON.stringify(publicQuestions(updated.quizQuestions))).not.toContain('correct_index');
    expect(gradeQuiz(updated.quizQuestions, [1, 1]).score).toBe(100);
    expect(oldAttempt).toEqual({ score: 100, passed: true });
    expect(saveAttempt).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      oldValues: expect.objectContaining({ quiz_questions: originalQuestions }),
      newValues: expect.objectContaining({ quiz_questions: edited }),
    }));
  });

  it.each([
    ['different number of questions', (questions: AcademyQuizQuestion[]) => questions.slice(0, 1)],
    ['different question id', (questions: AcademyQuizQuestion[]) => { questions[0].id = 'other'; return questions; }],
    ['different choice count', (questions: AcademyQuizQuestion[]) => { questions[0].options_ar.pop(); return questions; }],
    ['blank prompt', (questions: AcademyQuizQuestion[]) => { questions[0].prompt_ar = '   '; return questions; }],
    ['blank choice', (questions: AcademyQuizQuestion[]) => { questions[0].options_ar[0] = '   '; return questions; }],
    ['invalid correct choice', (questions: AcademyQuizQuestion[]) => { questions[0].correct_index = 3; return questions; }],
  ])('rejects %s without saving', async (_label, change) => {
    const { course, service, save } = fixture();
    const questions = change(structuredClone(originalQuestions));
    await expect(service.updateCourse('admin-id', course.id, { quiz_questions: questions })).rejects.toMatchObject({ status: 400 });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects malformed nested questions before calling the service', () => {
    const body = plainToInstance(UpdateAcademyCourseDto, {
      quiz_questions: [{ id: 'q1', prompt_ar: '', options_ar: ['only one'], correct_index: '0' }],
    });
    expect(validateSync(body, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
    const valid = plainToInstance(UpdateAcademyCourseDto, { quiz_questions: structuredClone(originalQuestions) });
    expect(validateSync(valid, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const nullQuiz = plainToInstance(UpdateAcademyCourseDto, { quiz_questions: null });
    expect(validateSync(nullQuiz, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });

  it('keeps the existing activation-only update compatible', async () => {
    const { course, service, save } = fixture();
    const before = structuredClone(course.quizQuestions);
    await service.updateCourse('admin-id', course.id, { is_active: false });
    expect(save).toHaveBeenCalledTimes(1);
    expect(course.isActive).toBe(false);
    expect(course.quizQuestions).toEqual(before);
  });
});
