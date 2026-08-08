'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateEmployeeBody, EmployeeResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export default function NewEmployeePage() {
  const { authedFetch } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState<CreateEmployeeBody>({
    phone_number: '+20',
    full_name: '',
    department: '',
    title: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const body: CreateEmployeeBody = { ...form };
      if (!body.title) delete body.title;
      const employee = await authedFetch<EmployeeResponseDto>('/admin/employees', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(`/employees/${employee.user_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-xl font-semibold">إضافة موظف</h1>
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
            {error && <p className="text-sm text-destructive">{error}</p>}
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
