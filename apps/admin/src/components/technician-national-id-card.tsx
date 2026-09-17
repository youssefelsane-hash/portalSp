'use client';

import { useState } from 'react';
import { formatDateTimeAr } from '@/lib/format';
import type { AdminTechnicianDetailResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice, Notice } from '@/components/notice';

type NationalIdSummary = AdminTechnicianDetailResponseDto['national_id'];

/**
 * الهوية الدائمة للفني (ADR-0045، docs/08 §77-E1).
 *
 * **الفجوة اللي الكارت ده بيقفلها**: الباك-إند اتبنى كامل في §74-أ — تشفير AES-GCM، blind
 * index للتفرّد، فهرس فريد جزئي بيمنع تكرار الرقم بين حسابين نشطين، وقيد بيمنع الاعتماد بلا
 * رقم قومي. وكل ده كان **بلا أي مسار إدخال**: مفيش حقل في لوحة الأدمن ولا في تطبيق الفني.
 * يعني ميزة أمان كاملة موجودة ومحدش يقدر يستخدمها.
 *
 * **الرقم بيتعرض مقنّع دايمًا** (آخر 4 أرقام). الكشف الكامل نداء منفصل بصلاحية صريحة، فكل
 * كشف بيبقى فعل مقصود مش أثر جانبي لفتح الصفحة — ودي مش تفصيلة: الصفحة دي بتتفتح عشرات
 * المرات في اليوم لأسباب مالها علاقة بالهوية.
 */
export function NationalIdCard({
  technicianId,
  nationalId,
  canManage,
  onChanged,
}: {
  technicianId: string;
  nationalId: NationalIdSummary;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { authedFetch } = useAuth();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [editing, setEditing] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/${technicianId}/national-id`, {
        method: 'PATCH',
        body: JSON.stringify({ national_id: value.trim() }),
      });
      setValue('');
      setEditing(false);
      setRevealed(null);
      onChanged();
    } catch (err) {
      // رسالة الباك-إند بتقول السبب بالظبط (رقم غير صالح / مستخدم عند فني تاني / اتغيّر بعد
      // الاعتماد) — أفضل بكتير من نص عام هنا.
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في حفظ الرقم القومي');
    } finally {
      setSaving(false);
    }
  }

  async function reveal() {
    setRevealing(true);
    setError(null);
    try {
      const data = await authedFetch<{ national_id: string | null }>(
        `/admin/technicians/${technicianId}/national-id`,
      );
      setRevealed(data.national_id ?? '—');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر كشف الرقم');
    } finally {
      setRevealing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          الرقم القومي — الهوية الدائمة
          {nationalId.has_value ? (
            <Badge variant="secondary">مسجّل</Badge>
          ) : (
            <Badge variant="destructive">غير مسجّل</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {/* تنبيه مؤطّر مش نص ملوّن سايب: في لقطة حقيقية كان سطر أصفر طويل جوّه الكارت مفيش
            حاجة تقول إنه تحذير أصلاً. */}
        {!nationalId.has_value && (
          <Notice tone="warning" title="مفيش رقم قومي مسجّل" className="mb-0">
            الاعتماد مش هيعدّي من غيره، وما ينفعش نمنع رجوعه بحساب جديد لو اتوقف.
          </Notice>
        )}

        {nationalId.has_value && (
          <>
            <p dir="ltr" className="text-start font-mono text-base">
              {revealed ?? nationalId.masked}
            </p>
            {nationalId.set_at && (
              <p className="text-muted-foreground">
                اتسجّل: {(formatDateTimeAr(nationalId.set_at) ?? '—')}
              </p>
            )}
            {canManage && !revealed && (
              <Button size="sm" variant="outline" className="self-start" onClick={reveal} disabled={revealing}>
                {revealing ? 'بيتحمّل…' : 'اكشف الرقم كامل'}
              </Button>
            )}
          </>
        )}

        {/* إشارة «الشخص ده كان عندنا قبل كده» — الغرض الأساسي من الحقل كله. الحسابات المتشالة
            داخلة عمدًا: فني اتوقف وحسابه اتمسح ورجع تاني هو بالظبط الحالة اللي بندوّر عليها. */}
        {nationalId.linked_account_codes.length > 0 && (
          <Notice
            tone="error"
            title={`نفس الرقم القومي مستخدم في ${nationalId.linked_account_codes.length} حساب تاني`}
            className="mb-0"
          >
            {/* الأكواد شرائح مش نص مفصول بفواصل — الكود قابل للبحث، والعدد بيبان بالعين. */}
            <div className="flex flex-wrap gap-1">
              {nationalId.linked_account_codes.map((code) => (
                <span key={code} dir="ltr" className="rounded-md border border-current/30 px-1.5 py-0.5 text-xs leading-4">
                  {code}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-xs opacity-80">
              راجع سبب إيقاف/حذف الحساب القديم قبل الاعتماد — دي إشارة إن الشخص ده رجع تاني.
            </p>
          </Notice>
        )}

        {canManage && (
          <>
            {!editing ? (
              <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing(true)}>
                {nationalId.has_value ? 'تعديل الرقم' : 'سجّل الرقم القومي'}
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="national_id_input">الرقم القومي (14 رقم)</Label>
                <Input
                  id="national_id_input"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={20}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="اقرا الرقم من صورة البطاقة المرفوعة"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={save} disabled={saving || value.trim().length === 0}>
                    {saving ? 'بيتحفظ…' : 'حفظ'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setValue('');
                      setError(null);
                    }}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
      </CardContent>
    </Card>
  );
}
