'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { SettingResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

// كارت "نصايح مفيدة" الواحد — مطابق لـ apps/api/src/modules/settings/homepage-content.controller.ts's
// HomepageTipDto. image_url رابط حر بيحطه الأدمن (طلب مالك صريح 2026-08-23: "خلي كله لينكات" —
// لينكات بس، مفيش رفع ملف حقيقي هنا عمداً، أبسط وأسرع تنفيذ وأثبت عند المالك نفسه إنها شغالة).
interface HomepageTip {
  title: string;
  body: string;
  image_url: string | null;
}

const EMPTY_TIP: HomepageTip = { title: '', body: '', image_url: null };

// إدارة محتوى الصفحة الرئيسية (customer-web/customer-app) — رسالة الثقة/الضمان + "نصايح مفيدة"
// (docs/08 §48). صفر endpoint جديد — الاتنين settings عاديين (`homepage.trust_message` من
// 2026-08-22، `homepage.tips` جديد) بيتحدّثوا عبر `/admin/settings/:key` الموجود بالفعل، نفس
// آلية Step-Up تلقائي (`authedFetch`) زي أي صفحة تانية في اللوحة.
export default function HomepageContentPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [trustMessage, setTrustMessage] = useState('');
  // نصوص الـhero (docs/08 §64.د) — كانت مكتوبة ثابتة في كود التطبيقين، فأي تعديل صياغة كان
  // يحتاج release. بقت 4 إعدادات عادية زي trust_message بالحرف.
  const [heroTexts, setHeroTexts] = useState({ eyebrow: '', title: '', subtitle: '', searchPlaceholder: '' });
  const [isSavingHeroTexts, setIsSavingHeroTexts] = useState(false);
  const [heroImages, setHeroImages] = useState<string[]>([]);
  const [tips, setTips] = useState<HomepageTip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSavingMessage, setIsSavingMessage] = useState(false);
  const [isSavingHeroImages, setIsSavingHeroImages] = useState(false);
  const [isSavingTips, setIsSavingTips] = useState(false);

  function load() {
    authedFetch<SettingResponseDto[]>('/admin/settings?group=homepage')
      .then((settings) => {
        const messageSetting = settings.find((s) => s.key === 'homepage.trust_message');
        const heroImagesSetting = settings.find((s) => s.key === 'homepage.hero_images');
        const tipsSetting = settings.find((s) => s.key === 'homepage.tips');
        if (messageSetting) setTrustMessage(String(messageSetting.value ?? ''));
        if (heroImagesSetting) setHeroImages((heroImagesSetting.value as string[] | null) ?? []);
        if (tipsSetting) setTips((tipsSetting.value as HomepageTip[] | null) ?? []);
        const text = (key: string) => String(settings.find((s) => s.key === key)?.value ?? '');
        setHeroTexts({
          eyebrow: text('homepage.hero_eyebrow'),
          title: text('homepage.hero_title'),
          subtitle: text('homepage.hero_subtitle'),
          searchPlaceholder: text('homepage.search_placeholder'),
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل محتوى الصفحة الرئيسية'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function saveTrustMessage() {
    setIsSavingMessage(true);
    try {
      await authedFetch('/admin/settings/homepage.trust_message', {
        method: 'PATCH',
        body: JSON.stringify({ value: trustMessage }),
      });
      toast.success('اترفعت رسالة الثقة بنجاح');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل حفظ رسالة الثقة');
    } finally {
      setIsSavingMessage(false);
    }
  }

  async function saveHeroTexts() {
    setIsSavingHeroTexts(true);
    try {
      // أربع نداءات منفصلة عمدًا: `/admin/settings/:key` هو المسار الموجود بالفعل، ومفيش داعي
      // لـendpoint دفعة واحدة عشان أربع حقول بيتحفظوا مرة كل كام أسبوع.
      const entries: [string, string][] = [
        ['homepage.hero_eyebrow', heroTexts.eyebrow],
        ['homepage.hero_title', heroTexts.title],
        ['homepage.hero_subtitle', heroTexts.subtitle],
        ['homepage.search_placeholder', heroTexts.searchPlaceholder],
      ];
      for (const [key, value] of entries) {
        await authedFetch(`/admin/settings/${key}`, {
          method: 'PATCH',
          body: JSON.stringify({ value }),
        });
      }
      toast.success('اتحفظت نصوص الواجهة');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل حفظ نصوص الواجهة');
    } finally {
      setIsSavingHeroTexts(false);
    }
  }

  async function saveTips() {
    setIsSavingTips(true);
    try {
      await authedFetch('/admin/settings/homepage.tips', {
        method: 'PATCH',
        body: JSON.stringify({ value: tips }),
      });
      toast.success('اترفعت النصايح بنجاح');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل حفظ النصايح');
    } finally {
      setIsSavingTips(false);
    }
  }

  async function saveHeroImages() {
    const normalized = heroImages.map((url) => url.trim()).filter(Boolean);
    if (normalized.some((url) => !url.startsWith('https://') && !url.startsWith('/uploads/'))) {
      toast.error('كل صورة لازم تكون رابط HTTPS أو مسار /uploads/');
      return;
    }
    setIsSavingHeroImages(true);
    try {
      await authedFetch('/admin/settings/homepage.hero_images', {
        method: 'PATCH',
        body: JSON.stringify({ value: normalized.slice(0, 4) }),
      });
      setHeroImages(normalized.slice(0, 4));
      toast.success('اتحفظت صور الواجهة الرئيسية');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل حفظ صور الواجهة');
    } finally {
      setIsSavingHeroImages(false);
    }
  }

  function updateTip(index: number, patch: Partial<HomepageTip>) {
    setTips((current) => current.map((tip, i) => (i === index ? { ...tip, ...patch } : tip)));
  }

  function removeTip(index: number) {
    setTips((current) => current.filter((_, i) => i !== index));
  }

  if (!hasPermission('settings.manage')) {
    return (
      <AppShell>
        <PageHeader title="محتوى الصفحة الرئيسية" />
        <p className="text-sm text-muted-foreground">مفيش صلاحية عندك تشوف الصفحة دي.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="محتوى الصفحة الرئيسية"
        description="صور الواجهة المتحركة ورسالة الثقة و«نصايح مفيدة» للويب والموبايل — بيتحدّثوا من مكان واحد من غير deployment."
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium">رسالة الثقة/الضمان</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="trust_message">النص المعروض فوق صورة الـhero</Label>
          <Input id="trust_message" value={trustMessage} onChange={(e) => setTrustMessage(e.target.value)} className="mt-2" />
        </CardContent>
        <CardFooter>
          <Button size="sm" disabled={isSavingMessage} onClick={() => void saveTrustMessage()}>
            {isSavingMessage ? 'جاري الحفظ…' : 'حفظ'}
          </Button>
        </CardFooter>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium">نصوص واجهة البحث</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            الكلام اللي بيظهر فوق شريط البحث في الشاشة الرئيسية (التطبيق والويب). سيبه فاضي عشان يرجع للنص الافتراضي.
          </p>
          <div>
            <Label htmlFor="hero_eyebrow">السطر الصغير فوق العنوان</Label>
            <Input
              id="hero_eyebrow"
              value={heroTexts.eyebrow}
              placeholder="أساعدك إزاي؟"
              onChange={(e) => setHeroTexts((c) => ({ ...c, eyebrow: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="hero_title">العنوان الرئيسي</Label>
            <Input
              id="hero_title"
              value={heroTexts.title}
              placeholder="محتاج مساعدة في إيه؟"
              onChange={(e) => setHeroTexts((c) => ({ ...c, title: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="hero_subtitle">السطر التوضيحي تحت العنوان</Label>
            <Input
              id="hero_subtitle"
              value={heroTexts.subtitle}
              placeholder="قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت"
              onChange={(e) => setHeroTexts((c) => ({ ...c, subtitle: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="search_placeholder">النص الرمادي جوّه شريط البحث</Label>
            <Input
              id="search_placeholder"
              value={heroTexts.searchPlaceholder}
              placeholder={'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"'}
              onChange={(e) => setHeroTexts((c) => ({ ...c, searchPlaceholder: e.target.value }))}
              className="mt-1"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button size="sm" disabled={isSavingHeroTexts} onClick={() => void saveHeroTexts()}>
            {isSavingHeroTexts ? 'جاري الحفظ…' : 'حفظ النصوص'}
          </Button>
        </CardFooter>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium">صور الواجهة المتحركة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            أضف من صورة إلى 4 صور. هتتبدل تلقائيًا بالترتيب، ولو القائمة فاضية هنستخدم صورة Splash القديمة.
          </p>
          {heroImages.map((url, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor={`hero-image-${index}`}>صورة {index + 1}</Label>
                <Input
                  id={`hero-image-${index}`}
                  dir="ltr"
                  placeholder="https://..."
                  value={url}
                  onChange={(event) => setHeroImages((current) => current.map((item, i) => (i === index ? event.target.value : item)))}
                  className="mt-1"
                />
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setHeroImages((current) => current.filter((_, i) => i !== index))}>
                حذف
              </Button>
            </div>
          ))}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button size="sm" variant="outline" disabled={heroImages.length >= 4} onClick={() => setHeroImages((current) => [...current, ''])}>
            ضيف صورة
          </Button>
          <Button size="sm" disabled={isSavingHeroImages} onClick={() => void saveHeroImages()}>
            {isSavingHeroImages ? 'جاري الحفظ…' : 'حفظ الصور'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">نصايح مفيدة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {tips.length === 0 && <p className="text-sm text-muted-foreground">مفيش نصايح دلوقتي — دوس &quot;ضيف نصيحة&quot; تحت.</p>}
          {tips.map((tip, index) => (
            <div key={index} className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">نصيحة {index + 1}</span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeTip(index)}>
                  حذف
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <Label htmlFor={`tip-title-${index}`}>العنوان</Label>
                  <Input
                    id={`tip-title-${index}`}
                    value={tip.title}
                    onChange={(e) => updateTip(index, { title: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`tip-body-${index}`}>النص</Label>
                  <Textarea
                    id={`tip-body-${index}`}
                    value={tip.body}
                    onChange={(e) => updateTip(index, { body: e.target.value })}
                    className="mt-1"
                    rows={2}
                  />
                </div>
                <div>
                  <Label htmlFor={`tip-image-${index}`}>رابط الصورة (اختياري)</Label>
                  <Input
                    id={`tip-image-${index}`}
                    dir="ltr"
                    placeholder="https://..."
                    value={tip.image_url ?? ''}
                    onChange={(e) => updateTip(index, { image_url: e.target.value || null })}
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    لو سايبها فاضية، هيظهر تدرّج لوني افتراضي بدل الصورة — مفيش رفع ملف هنا، رابط جاهز بس.
                  </p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTips((current) => [...current, { ...EMPTY_TIP }])}>
            ضيف نصيحة
          </Button>
          <Button size="sm" disabled={isSavingTips} onClick={() => void saveTips()}>
            {isSavingTips ? 'جاري الحفظ…' : 'حفظ النصايح'}
          </Button>
        </CardFooter>
      </Card>
    </AppShell>
  );
}
