'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  AcademyCourseResponseDto,
  AcademyExamAttemptResponseDto,
  AdminAcademyCourseEditResponseDto,
  AdminTechnicianResponseDto,
  CreateAcademyCourseBody,
  RecordExamAttemptBody,
  UpdateAcademyCourseBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ErrorNotice } from '@/components/notice';

export default function AcademyPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [courses, setCourses] = useState<AcademyCourseResponseDto[] | null>(null);
  const [editingCourse, setEditingCourse] = useState<AdminAcademyCourseEditResponseDto | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [technicians, setTechnicians] = useState<AdminTechnicianResponseDto[] | null>(null);
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('');
  const [attempts, setAttempts] = useState<AcademyExamAttemptResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function loadCourses() {
    authedFetch<AcademyCourseResponseDto[]>('/admin/academy/courses')
      .then(setCourses)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الكورسات'));
  }

  useEffect(() => {
    if (isLoading) return;
    loadCourses();
    authedFetch<AdminTechnicianResponseDto[]>('/admin/technicians?verification_status=approved&per_page=100')
      .then(setTechnicians)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفنيين'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  function loadAttempts(technicianId: string) {
    setSelectedTechnicianId(technicianId);
    if (!technicianId) {
      setAttempts(null);
      return;
    }
    authedFetch<AcademyExamAttemptResponseDto[]>(`/admin/academy/technicians/${technicianId}/exam-attempts`)
      .then(setAttempts)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل نتائج الاختبارات'));
  }

  async function handleCreateCourse(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateAcademyCourseBody = {
      title_ar: form.get('title_ar') as string,
      title_en: form.get('title_en') as string,
      description_ar: (form.get('description_ar') as string) || undefined,
      passing_score: Number(form.get('passing_score') as string) || 60,
      display_order: Number(form.get('display_order') as string) || 0,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/academy/courses', { method: 'POST', body: JSON.stringify(body) });
      setShowNewCourse(false);
      loadCourses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleCourseActive(course: AcademyCourseResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/academy/courses/${course.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !course.is_active }),
      });
      loadCourses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function openQuestionEditor(courseId: string) {
    setError(null);
    setEditingCourse(null);
    setIsLoadingQuestions(true);
    try {
      const course = await authedFetch<AdminAcademyCourseEditResponseDto>(`/admin/academy/courses/${courseId}`);
      if (course.quiz_questions.length === 0) {
        setError('الكورس ده ما فيهوش أسئلة اختبار للتعديل.');
        return;
      }
      setEditingCourse(course);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الأسئلة');
    } finally {
      setIsLoadingQuestions(false);
    }
  }

  function updateQuestion(index: number, patch: Partial<AdminAcademyCourseEditResponseDto['quiz_questions'][number]>) {
    setEditingCourse((course) => course && {
      ...course,
      quiz_questions: course.quiz_questions.map((question, i) => i === index ? { ...question, ...patch } : question),
    });
  }

  function updateChoice(questionIndex: number, choiceIndex: number, value: string) {
    setEditingCourse((course) => course && {
      ...course,
      quiz_questions: course.quiz_questions.map((question, i) => i === questionIndex ? {
        ...question,
        options_ar: question.options_ar.map((choice, j) => j === choiceIndex ? value : choice),
      } : question),
    });
  }

  async function handleSaveQuestions(e: FormEvent) {
    e.preventDefault();
    if (!editingCourse) return;
    if (editingCourse.quiz_questions.some((question) =>
      !question.prompt_ar.trim() || question.options_ar.some((choice) => !choice.trim()) ||
      question.correct_index < 0 || question.correct_index >= question.options_ar.length
    )) {
      setError('اكتب كل سؤال واختياراته وحدد الإجابة الصحيحة قبل الحفظ.');
      return;
    }
    const body: UpdateAcademyCourseBody = { quiz_questions: editingCourse.quiz_questions };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/academy/courses/${editingCourse.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEditingCourse(null);
      loadCourses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في حفظ الأسئلة');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRecordAttempt(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: RecordExamAttemptBody = {
      technician_id: form.get('technician_id') as string,
      course_id: form.get('course_id') as string,
      score: Number(form.get('score') as string),
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/academy/exam-attempts', { method: 'POST', body: JSON.stringify(body) });
      (e.target as HTMLFormElement).reset();
      if (body.technician_id === selectedTechnicianId) loadAttempts(selectedTechnicianId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  const courseTitle = (id: string) => courses?.find((c) => c.id === id)?.title_ar ?? id;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          className="mb-0"
          title="الأكاديمية"
          description="كورسات تدريب الفنيين وأسئلة الاختبار ونتائجهم. الامتحان الإلزامي بيتصحح تلقائيًا على السيرفر."
        />

        {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>الكورسات ({courses?.length ?? 0})</CardTitle>
              <CardDescription>حد النجاح الافتراضي 60% لو مش محدد.</CardDescription>
            </div>
            {hasPermission('academy.manage') && (
              <Button size="sm" variant="outline" onClick={() => setShowNewCourse((s) => !s)}>
                + كورس جديد
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {showNewCourse && hasPermission('academy.manage') && (
              <form onSubmit={handleCreateCourse} className="grid grid-cols-1 gap-3 rounded-md border p-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="title_ar">العنوان (عربي)</Label>
                  <Input id="title_ar" name="title_ar" required minLength={2} maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="title_en">العنوان (إنجليزي)</Label>
                  <Input id="title_en" name="title_en" required minLength={2} maxLength={200} dir="ltr" />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="description_ar">الوصف (اختياري)</Label>
                  <Textarea id="description_ar" name="description_ar" rows={2} />
                </div>
                <div>
                  <Label htmlFor="passing_score">حد النجاح %</Label>
                  <Input id="passing_score" name="passing_score" type="number" min={0} max={100} defaultValue={60} dir="ltr" />
                </div>
                <div>
                  <Label htmlFor="display_order">ترتيب العرض</Label>
                  <Input id="display_order" name="display_order" type="number" defaultValue={0} dir="ltr" />
                </div>
                <Button type="submit" size="sm" disabled={isSaving} className="w-fit sm:col-span-2">
                  حفظ الكورس
                </Button>
              </form>
            )}

            {!courses ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : courses.length === 0 ? (
              <EmptyState title="مفيش كورسات لسه" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العنوان</TableHead>
                    <TableHead>حد النجاح</TableHead>
                    <TableHead>الحالة</TableHead>
                    {hasPermission('academy.manage') && <TableHead>الأسئلة</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((course) => (
                    <TableRow key={course.id}>
                      <TableCell>
                        <div className="font-medium">{course.title_ar}</div>
                        {course.description_ar && (
                          <div className="text-xs text-muted-foreground">{course.description_ar}</div>
                        )}
                      </TableCell>
                      <TableCell>{course.passing_score}%</TableCell>
                      <TableCell>
                        {hasPermission('academy.manage') ? (
                          <button type="button" disabled={isSaving} onClick={() => toggleCourseActive(course)} className="cursor-pointer">
                            <Badge variant={course.is_active ? 'secondary' : 'outline'}>
                              {course.is_active ? 'نشط' : 'معطّل'}
                            </Badge>
                          </button>
                        ) : (
                          <Badge variant={course.is_active ? 'secondary' : 'outline'}>
                            {course.is_active ? 'نشط' : 'معطّل'}
                          </Badge>
                        )}
                      </TableCell>
                      {hasPermission('academy.manage') && (
                        <TableCell>
                          {course.question_count ? (
                            <Button type="button" size="sm" variant="outline" disabled={isSaving || isLoadingQuestions} onClick={() => openQuestionEditor(course.id)}>
                              تعديل الأسئلة ({course.question_count})
                            </Button>
                          ) : (
                            <span className="text-sm text-muted-foreground">لا توجد أسئلة</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {isLoadingQuestions && <p className="text-sm text-muted-foreground">جاري تحميل الأسئلة…</p>}

        {editingCourse && hasPermission('academy.manage') && (
          <Card>
            <CardHeader>
              <CardTitle>تعديل أسئلة: {editingCourse.title_ar}</CardTitle>
              <CardDescription>تقدر تغيّر صياغة السؤال والاختيارات والإجابة الصحيحة. عدد الأسئلة والاختيارات ثابت، ونتائج الاختبارات السابقة لا تتغير.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveQuestions} className="space-y-6">
                {editingCourse.quiz_questions.map((question, questionIndex) => (
                  <fieldset key={question.id} className="space-y-4 rounded-lg border p-4">
                    <legend className="px-2 font-semibold">السؤال {questionIndex + 1}</legend>
                    <div>
                      <Label htmlFor={`academy-question-${question.id}`}>نص السؤال</Label>
                      <Textarea
                        id={`academy-question-${question.id}`}
                        value={question.prompt_ar}
                        onChange={(e) => updateQuestion(questionIndex, { prompt_ar: e.target.value })}
                        required
                        maxLength={500}
                        rows={2}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {question.options_ar.map((choice, choiceIndex) => (
                        <div key={choiceIndex}>
                          <Label htmlFor={`academy-choice-${question.id}-${choiceIndex}`}>الاختيار {choiceIndex + 1}</Label>
                          <Input
                            id={`academy-choice-${question.id}-${choiceIndex}`}
                            value={choice}
                            onChange={(e) => updateChoice(questionIndex, choiceIndex, e.target.value)}
                            required
                            maxLength={300}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="max-w-xs">
                      <Label htmlFor={`academy-answer-${question.id}`}>الإجابة الصحيحة</Label>
                      <SelectNative
                        id={`academy-answer-${question.id}`}
                        value={question.correct_index}
                        onChange={(e) => updateQuestion(questionIndex, { correct_index: Number(e.target.value) })}
                      >
                        {question.options_ar.map((_choice, choiceIndex) => (
                          <option key={choiceIndex} value={choiceIndex}>الاختيار {choiceIndex + 1}</option>
                        ))}
                      </SelectNative>
                    </div>
                  </fieldset>
                ))}
                <div className="flex gap-2">
                  <Button type="submit" disabled={isSaving}>حفظ الأسئلة</Button>
                  <Button type="button" variant="outline" disabled={isSaving} onClick={() => setEditingCourse(null)}>إلغاء</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {hasPermission('academy.manage') && (
          <Card>
            <CardHeader>
              <CardTitle>تسجيل نتيجة اختبار</CardTitle>
              <CardDescription>تسجيل يدوي لنتيجة فني في كورس معيّن — النجاح/الرسوب بيتحسب تلقائيًا مقابل حد النجاح.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecordAttempt} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="attempt_technician_id">الفني</Label>
                  <SelectNative id="attempt_technician_id" name="technician_id" required defaultValue="">
                    <option value="" disabled>
                      اختر فني
                    </option>
                    {technicians?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.technician_code})
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <Label htmlFor="attempt_course_id">الكورس</Label>
                  <SelectNative id="attempt_course_id" name="course_id" required defaultValue="">
                    <option value="" disabled>
                      اختر كورس
                    </option>
                    {courses?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title_ar}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <Label htmlFor="attempt_score">الدرجة %</Label>
                  <Input id="attempt_score" name="score" type="number" min={0} max={100} required dir="ltr" />
                </div>
                <Button type="submit" size="sm" disabled={isSaving} className="w-fit sm:col-span-3">
                  تسجيل النتيجة
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>سجل نتائج فني معيّن</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-sm">
              <Label htmlFor="lookup_technician_id">اختر فني</Label>
              <SelectNative
                id="lookup_technician_id"
                value={selectedTechnicianId}
                onChange={(e) => loadAttempts(e.target.value)}
              >
                <option value="">— اختر —</option>
                {technicians?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} ({t.technician_code})
                  </option>
                ))}
              </SelectNative>
            </div>

            {selectedTechnicianId && (
              <>
                {!attempts ? (
                  <p className="text-sm text-muted-foreground">جاري التحميل…</p>
                ) : attempts.length === 0 ? (
                  <EmptyState title="مفيش نتائج اختبارات مسجّلة للفني ده لسه" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الكورس</TableHead>
                        <TableHead>الدرجة</TableHead>
                        <TableHead>النتيجة</TableHead>
                        <TableHead>التاريخ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attempts.map((attempt) => (
                        <TableRow key={attempt.id}>
                          <TableCell>{courseTitle(attempt.course_id)}</TableCell>
                          <TableCell>{attempt.score}%</TableCell>
                          <TableCell>
                            <Badge variant={attempt.passed ? 'secondary' : 'destructive'}>
                              {attempt.passed ? 'ناجح' : 'راسب'}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(attempt.attempted_at).toLocaleString('ar-EG')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
