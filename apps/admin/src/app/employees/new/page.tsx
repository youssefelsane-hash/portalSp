'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateEmployeeBody, EmployeeResponseDto, RoleResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { ErrorNotice } from '@/components/notice';
import { OneTimeCodeDialog } from '@/components/one-time-code-dialog';

/** رد الإنشاء بيحمل كود التنشيط كمان (ADR-0111) — بيرجع مرة واحدة وبس. */
type CreatedEmployee = EmployeeResponseDto & {
  activation_code: string;
  activation_code_expires_at: string;
};

export default function NewEmployeePage() {
  const { authedFetch, isLoading } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState<CreateEmployeeBody>({
    phone_number: '+20',
    full_name: '',
    department: '',
    title: '',
  });
  // منح أول دور وقت الإنشاء مباشرة (initial_role_name كان موجود في CreateEmployeeDto بلا أي
  // حقل يستخدمه هنا — الموظف كان بيتعمل من غير أي دور، والأدمن مضطر يروح لصفحة الموظف بعد كده
  // يمنحه دور من فورم منفصل).
  const [allRoles, setAllRoles] = useState<RoleResponseDto[] | null>(null);
  const [initialRoleName, setInitialRoleName] = useState('');
  const [created, setCreated] = useState<CreatedEmployee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // مستنّي التوكن يجهز (docs/08 §148): من غير الشرط ده الجلب بيحصل قبل ما
  // `trySilentRefresh()` تخلص، فبيروح بلا توكن ⇒ 401 ⇒ refresh زيادة ⇒ إعادة محاولة.
  useEffect(() => {
    if (isLoading) return;
    authedFetch<RoleResponseDto[]>('/admin/roles')
      .then(setAllRoles)
      .catch(() => setAllRoles([]));
  }, [authedFetch, isLoading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const body: CreateEmployeeBody = { ...form };
      if (!body.title) delete body.title;
      if (initialRoleName) body.initial_role_name = initialRoleName;
      const employee = await authedFetch<CreatedEmployee>('/admin/employees', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      // **الكود لازم يتعرض قبل الانتقال** (ADR-0111): بيرجع **مرة واحدة** ومتخزّن مجزّأ، فالانتقال
      // المباشر للصفحة التفصيلية كان بيضيّعه — والموظف ساعتها مالوش أي طريقة يدخل بيها غير إن
      // الأدمن يصدر كود تاني. الانتقال بيحصل بعد ما الأدمن يأكّد إنه بعت الكود.
      setCreated(employee);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <OneTimeCodeDialog
        open={created !== null}
        title="كود تنشيط الموظف"
        code={created?.activation_code ?? null}
        testId="employee-activation-code"
        description={
          <>
            الحساب اتعمل، بس الموظف <b>لسه مالوش رمز دخول</b>. ابعتله الكود ده دلوقتي — بيكتبه من
            شاشة الدخول ← «نسيت رمز الدخول؟» ويختار رمزه بنفسه. صالح ١٥ دقيقة ولمرة واحدة، ومش
            هتقدر تشوفه تاني. لو ضاع، تقدر تصدر واحد جديد من صفحة الموظف.
          </>
        }
        confirmLabel="بعتّ الكود — كمّل"
        onConfirm={() => {
          if (created) router.push(`/employees/${created.user_id}`);
        }}
      />
      <PageHeader
        title="إضافة موظف"
        description="بعد الحفظ هيطلع كود تنشيط تبعته للموظف عشان يحط رمز دخوله بنفسه. الصلاحيات كلها جاية من الدور مش من الحساب."
      />
      <Card className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle className="text-base">بيانات الموظف</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone_number">رقم الموبايل</Label>
              <Input
                id="phone_number"
                dir="ltr"
                value={form.phone_number}
                onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="full_name">الاسم بالكامل</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="department">القسم</Label>
              <Input
                id="department"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">المسمّى الوظيفي (اختياري)</Label>
              <Input
                id="title"
                value={form.title ?? ''}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="initial_role">الدور (اختياري)</Label>
              <SelectNative
                id="initial_role"
                value={initialRoleName}
                onChange={(e) => setInitialRoleName(e.target.value)}
              >
                <option value="">— من غير دور دلوقتي —</option>
                {(allRoles ?? []).map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.displayName}
                  </option>
                ))}
              </SelectNative>
            </div>
            {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'جاري الحفظ…' : 'حفظ'}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              إلغاء
            </Button>
          </CardFooter>
        </form>
      </Card>
    </AppShell>
  );
}
