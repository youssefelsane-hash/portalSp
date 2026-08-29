'use client';

import { useEffect, useState } from 'react';
import type { SettingResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface PaymentChannelStatus {
  method: string;
  is_enabled: boolean;
  is_configured: boolean;
  is_available: boolean;
  unavailable_reason: string | null;
  // تشخيص تشغيلي بيوصل للأدمن بس (docs/08 §76-ز) — العميل بياخد جملة عامة في
  // `unavailable_reason` بدل أسماء إعدادات ناقصة.
  admin_note?: string;
}

// وعاء العمولة (ADR-0037، docs/08 §60.1/§60.4) — طلب مالك صريح بمكان واحد في الأدمن بيشيل
// كل تفاصيل الموضوع ده بحيث يفضل flexible.
//
// **مش محرك جديد**: المفاتيح دي نفسها اللي في جدول `settings`، وبتتحفظ بنفس الـendpoint بالظبط.
// الجزء ده تنظيم عرض بس — بيجمّعها في مكان واحد بلغة مفهومة بدل ما تبقى مبعترة وسط عشرات
// المفاتيح التقنية في قسم pricing العام.
// بيانات الجهة المشغّلة (docs/08 §100، قرار مالك 2026-08-29) — ليها كارت مخصص فوق بدل ما تتلخبط
// وسط عشرات مفاتيح الإعدادات الخام. المالك طلب «مكان واضح في الـAdmin يقدر يدخلها أو يغيرها
// بسهولة»، والتحرير هنا بيعدّي على نفس مسار /admin/settings/:key (صلاحية settings.manage +
// step-up MFA + تسجيل في audit_logs) — صفر بنية تحتية جديدة.
const LEGAL_ENTITY_KEYS = [
  'legal.platform_name_ar',
  'legal.platform_name_en',
  'legal.company_name_ar',
  'legal.company_name_en',
  'legal.legal_address',
  'legal.support_email',
  'legal.privacy_email',
  'legal.support_phone',
  'legal.website_url',
  'legal.commercial_register',
  'legal.tax_id',
];

const LEGAL_ENTITY_LABELS: Record<string, string> = {
  'legal.platform_name_ar': 'اسم المنصة (عربي)',
  'legal.platform_name_en': 'اسم المنصة (إنجليزي)',
  'legal.company_name_ar': 'الاسم القانوني للشركة (عربي)',
  'legal.company_name_en': 'الاسم القانوني للشركة (إنجليزي)',
  'legal.legal_address': 'العنوان القانوني المسجَّل',
  'legal.support_email': 'بريد الدعم الرسمي',
  'legal.privacy_email': 'بريد طلبات الخصوصية',
  'legal.support_phone': 'رقم التواصل الرسمي',
  'legal.website_url': 'الموقع الرسمي',
  'legal.commercial_register': 'رقم السجل التجاري',
  'legal.tax_id': 'الرقم الضريبي',
};

// المفاتيح اللي Google Play بيطلبها صراحةً قبل أول رفع — الكارت بيعلّم الناقص منها بوضوح
// بدل ما نكتشف إنها فاضية وقت المراجعة.
const LEGAL_ENTITY_REQUIRED_BEFORE_LAUNCH = new Set([
  'legal.legal_address',
  'legal.support_email',
  'legal.support_phone',
]);

const COMMISSION_BASE_KEYS = [
  'commission_base.include_level_premium',
  'commission_base.include_zone_surge',
  'commission_base.include_emergency_surcharge',
  'commission_base.include_inspection_fee',
  'commission_base.include_addons',
  'commission_base.include_additional_items',
  'commission_base.include_warranty',
  'commission_base.include_installment_interest',
  'commission_base.discount_reduces_technician_share',
  'pricing.auto_match_level_premium',
];

const COMMISSION_BASE_LABELS: Record<string, string> = {
  'commission_base.include_level_premium': 'مضاعف مستوى الفني',
  'commission_base.include_zone_surge': 'مضاعف المنطقة / التضخم',
  'commission_base.include_emergency_surcharge': 'رسوم الطوارئ',
  'commission_base.include_inspection_fee': 'رسوم المعاينة',
  'commission_base.include_addons': 'إضافات الكتالوج (وقت الحجز)',
  'commission_base.include_additional_items': 'بنود إضافية أثناء الشغل',
  'commission_base.include_warranty': 'الضمان الاختياري',
  'commission_base.include_installment_interest': 'فوائد / رسوم التقسيط',
  'commission_base.discount_reduces_technician_share': 'الخصم يتخصم من نصيب الفني',
  'pricing.auto_match_level_premium': 'فرق الفني المميّز في الاختيار التلقائي',
};

const PAYMENT_CHANNEL_LABELS: Record<string, string> = {
  cash: 'الدفع بعد الخدمة (كاش)',
  wallet: 'محفظة العميل',
  card: 'بطاقة Paymob',
  installment: 'التقسيط',
  instapay: 'InstaPay',
  fawry_reference: 'فوري',
};

function SettingValueEditor({
  setting,
  onSave,
  isSaving,
}: {
  setting: SettingResponseDto;
  onSave: (value: unknown) => void;
  isSaving: boolean;
}) {
  const isSecret = new Set([
    'payments.paymob.api_key',
    'payments.paymob.secret_key',
    'payments.paymob.hmac_secret',
  ]).has(setting.key);
  const [draft, setDraft] = useState(
    isSecret
      ? ''
      : setting.value_type === 'boolean' || setting.value_type === 'number' || setting.value_type === 'string'
      ? String(setting.value)
      : JSON.stringify(setting.value, null, 2),
  );

  const isDirty = isSecret
    ? draft.length > 0
    : draft !== String(setting.value) && !(setting.value_type === 'json' && draft === JSON.stringify(setting.value, null, 2));

  function handleSave() {
    let parsed: unknown = draft;
    if (setting.value_type === 'boolean') parsed = draft === 'true';
    else if (setting.value_type === 'number') parsed = Number(draft);
    else if (setting.value_type !== 'string') {
      try {
        parsed = JSON.parse(draft);
      } catch {
        window.alert('القيمة دي لازم تكون JSON صحيح');
        return;
      }
    }
    onSave(parsed);
  }

  if (setting.value_type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={draft === 'true' ? 'default' : 'outline'}
          disabled={isSaving}
          onClick={() => {
            setDraft('true');
            onSave(true);
          }}
        >
          مفعّل
        </Button>
        <Button
          size="sm"
          variant={draft === 'false' ? 'default' : 'outline'}
          disabled={isSaving}
          onClick={() => {
            setDraft('false');
            onSave(false);
          }}
        >
          معطّل
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type={isSecret ? 'password' : undefined}
        value={draft}
        placeholder={isSecret && setting.value ? 'مُعدّ بالفعل — اكتب قيمة جديدة للتغيير' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        dir={setting.value_type === 'number' ? 'ltr' : undefined}
        className="max-w-xs"
      />
      {isDirty && (
        <Button size="sm" disabled={isSaving} onClick={handleSave}>
          حفظ
        </Button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [settings, setSettings] = useState<SettingResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [paymentChannels, setPaymentChannels] = useState<PaymentChannelStatus[]>([]);

  function load() {
    authedFetch<SettingResponseDto[]>('/admin/settings')
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الإعدادات'));
    authedFetch<PaymentChannelStatus[]>('/payment-channels')
      .then(setPaymentChannels)
      .catch(() => setPaymentChannels([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleSave(key: string, value: unknown) {
    setSavingKey(key);
    setError(null);
    try {
      await authedFetch(`/admin/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setSavingKey(null);
    }
  }

  // المفاتيح دي ليها كارت مخصص تحت — بنستبعدها من العرض العام عشان ما تتكررش.
  const generalSettings = (settings ?? []).filter(
    (s) => !COMMISSION_BASE_KEYS.includes(s.key) && !LEGAL_ENTITY_KEYS.includes(s.key),
  );
  const legalEntitySettings = LEGAL_ENTITY_KEYS.map((key) => (settings ?? []).find((s) => s.key === key)).filter(
    (s): s is SettingResponseDto => s !== undefined,
  );
  const missingBeforeLaunch = legalEntitySettings.filter(
    (s) => LEGAL_ENTITY_REQUIRED_BEFORE_LAUNCH.has(s.key) && String(s.value ?? '').replace(/"/g, '').trim() === '',
  );
  const commissionBaseSettings = COMMISSION_BASE_KEYS.map((key) =>
    (settings ?? []).find((s) => s.key === key),
  ).filter((s): s is SettingResponseDto => s !== undefined);
  const groups = Array.from(new Set(generalSettings.map((s) => s.group_name))).sort();

  return (
    <AppShell>
      <PageHeader title="الإعدادات" />
      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!settings && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {paymentChannels.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">جاهزية طرق الدفع الظاهرة للعميل</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {paymentChannels.map((channel) => (
              <div key={channel.method} className="rounded-md border p-3">
                <p className="font-medium">{PAYMENT_CHANNEL_LABELS[channel.method] ?? channel.method}</p>
                <p className={channel.is_available ? 'text-sm text-green-700' : 'text-sm text-destructive'}>
                  {channel.is_available ? 'جاهزة وتظهر للعميل' : channel.admin_note ?? channel.unavailable_reason ?? 'غير جاهزة'}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {legalEntitySettings.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">بيانات الجهة المشغّلة (تظهر في الصفحات القانونية والفوتر)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              البيانات دي بتتسحب تلقائيًا في <strong>شروط الاستخدام</strong> و<strong>سياسة الخصوصية</strong> و
              <strong>صفحة حذف الحساب</strong> وفوتر الموقع. أي خانة سايباها فاضية <strong>مش هتظهر كسطر فاضي</strong> —
              هتتخفي بالكامل لحد ما تتملى. وأي تعديل هنا بيتسجّل في سجل النشاط.
            </p>
            {missingBeforeLaunch.length > 0 && (
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">ناقص قبل الرفع على Google Play:</p>
                <p className="mt-1">
                  {missingBeforeLaunch.map((s) => LEGAL_ENTITY_LABELS[s.key] ?? s.key).join('، ')}
                </p>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>البيان</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {legalEntitySettings.map((setting) => (
                  <TableRow key={setting.key}>
                    <TableCell className="font-medium">
                      {LEGAL_ENTITY_LABELS[setting.key] ?? setting.key}
                      {LEGAL_ENTITY_REQUIRED_BEFORE_LAUNCH.has(setting.key) && (
                        <span className="ms-1 text-xs text-amber-700">(مطلوب قبل الإطلاق)</span>
                      )}
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {setting.key}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                      {setting.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      <SettingValueEditor
                        setting={setting}
                        isSaving={savingKey === setting.key}
                        onSave={(value) => handleSave(setting.key, value)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {commissionBaseSettings.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">تقسيم الإيراد: إيه اللي الفني بياخد منه نصيب؟</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              نسبة عمولة الشركة بتتطبّق على <strong>وعاء العمولة</strong> بس — مش على إجمالي الطلب.
              أي مكوّن مطفي هنا بيروح للشركة <strong>100%</strong> والفني مالوش فيه نصيب. سعر الشغل
              الأساسي دايمًا داخل الوعاء (هو تعريف &quot;الشغل&quot; نفسه) فمفيش مفتاح ليه.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المكوّن</TableHead>
                  <TableHead>الشرح</TableHead>
                  <TableHead>داخل وعاء العمولة؟</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissionBaseSettings.map((setting) => (
                  <TableRow key={setting.key}>
                    <TableCell className="font-medium">
                      {COMMISSION_BASE_LABELS[setting.key] ?? setting.key}
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {setting.key}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                      {setting.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      <SettingValueEditor
                        setting={setting}
                        isSaving={savingKey === setting.key}
                        onSave={(value) => handleSave(setting.key, value)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group} className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">{group}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generalSettings
                  .filter((s) => s.group_name === group)
                  .map((setting) => (
                    <TableRow key={setting.key}>
                      <TableCell dir="ltr">{setting.key}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                        {setting.description ?? '—'}
                      </TableCell>
                      <TableCell>
                        <SettingValueEditor
                          setting={setting}
                          isSaving={savingKey === setting.key}
                          onSave={(value) => handleSave(setting.key, value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </AppShell>
  );
}
