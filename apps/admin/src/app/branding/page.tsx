'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AdminBrandingPayloadDto, BrandingAssetType } from '@baytak/shared-types';
import { BRANDING_ASSET_LABELS_AR, BRANDING_ASSET_TYPES } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// إدارة البراندنج (ADR-0014) — Super Admin يرفع/يستبدل/يمسح أي أصل من غير أي deployment.
// Step-Up (POST/DELETE) بيتعامل معاه تلقائيًا جوّه authedFetch، الصفحة دي مش عارفة عنه خالص.
export default function BrandingPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [payload, setPayload] = useState<AdminBrandingPayloadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<BrandingAssetType | null>(null);

  function load() {
    authedFetch<AdminBrandingPayloadDto>('/admin/branding')
      .then(setPayload)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل البراندنج'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleUpload(assetType: BrandingAssetType, file: File) {
    setUploadingType(assetType);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const updated = await authedFetch<AdminBrandingPayloadDto>(`/admin/branding/${assetType}`, {
        method: 'POST',
        body: formData,
      });
      setPayload(updated);
      toast.success('اترفع بنجاح');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل رفع الملف');
    } finally {
      setUploadingType(null);
    }
  }

  async function handleRemove(assetType: BrandingAssetType) {
    try {
      const updated = await authedFetch<AdminBrandingPayloadDto>(`/admin/branding/${assetType}`, { method: 'DELETE' });
      setPayload(updated);
      toast.success('رجع للـfallback الافتراضي');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل الحذف');
    }
  }

  if (!hasPermission('branding.manage')) {
    return (
      <AppShell>
        <PageHeader title="البراندنج" />
        <p className="text-sm text-muted-foreground">مفيش صلاحية عندك تشوف الصفحة دي.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="البراندنج"
        description="رفع/استبدال شعارات المنصة — بتتحدّث فورًا في كل التطبيقات من غير أي deployment. PNG/JPEG/WEBP بس، حتى 5MB، أبعاد بين 32 و4096 بكسل."
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BRANDING_ASSET_TYPES.map((assetType) => (
          <BrandingAssetCard
            key={assetType}
            assetType={assetType}
            asset={payload?.[assetType] ?? null}
            isUploading={uploadingType === assetType}
            onUpload={(file) => handleUpload(assetType, file)}
            onRemove={() => handleRemove(assetType)}
          />
        ))}
      </div>
    </AppShell>
  );
}

function BrandingAssetCard({
  assetType,
  asset,
  isUploading,
  onUpload,
  onRemove,
}: {
  assetType: BrandingAssetType;
  asset: AdminBrandingPayloadDto[BrandingAssetType] | null;
  isUploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          {BRANDING_ASSET_LABELS_AR[assetType]}
          {asset?.is_default === false && <Badge variant="secondary">مرفوع</Badge>}
          {asset?.is_default !== false && <Badge variant="outline">افتراضي</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* معاينة على الخلفيتين مع بعض (docs/08 §78-ج): التطبيق بيدعم الوضع الفاتح والداكن،
            فاللوجو بيتعرض فوق الاتنين فعلاً. معاينة على خلفية واحدة كانت بتخفي المشكلة الشائعة
            (لوجو أبيض على خلفية بيضا = مختفي) لحد ما تظهر على جهاز مستخدم حقيقي. */}
        <div className="grid h-24 grid-cols-2 overflow-hidden rounded-md border">
          {(['bg-white', 'bg-slate-900'] as const).map((bg) => (
            <div key={bg} className={`flex items-center justify-center ${bg}`}>
              {asset ? (
                // eslint-disable-next-line @next/next/no-img-element -- روابط ديناميكية (presigned/data URI)، مش أصل static معروف وقت البناء
                <img src={asset.url} alt={BRANDING_ASSET_LABELS_AR[assetType]} className="max-h-20 max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">جاري التحميل…</span>
              )}
            </div>
          ))}
        </div>
        {asset && asset.is_default === false && (
          <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
            {asset.width_px}×{asset.height_px}px · {asset.file_size_bytes ? Math.round(asset.file_size_bytes / 1024) : 0}KB
          </p>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="outline" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? 'جاري الرفع…' : 'استبدال'}
        </Button>
        {asset && asset.is_default === false && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" className="text-destructive">
                رجوع للافتراضي
              </Button>
            }
            title="ترجع للـfallback الافتراضي؟"
            description="الصورة المرفوعة حاليًا هتتشال من الاستخدام (مش هتتمسح من التخزين)."
            onConfirm={onRemove}
          />
        )}
      </CardFooter>
    </Card>
  );
}
