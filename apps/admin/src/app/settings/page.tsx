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
  const generalSettings = (settings ?? []).filter((s) => !COMMISSION_BASE_KEYS.includes(s.key));
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
