'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { daysAgoIso, todayIso } from '@/lib/analytics-format';

/** الاختصارات اللي الإدارة بتسأل بيها فعلاً — مش قايمة مفتوحة من غير سبب. */
const PRESETS: { label: string; days: number }[] = [
  { label: '٧ أيام', days: 7 },
  { label: '٣٠ يوم', days: 30 },
  { label: '٩٠ يوم', days: 90 },
];

/**
 * مدى زمني موحّد لكل شاشات التحليلات — نفس المكوّن في الأربع شاشات عشان «آخر ٣٠ يوم» تبقى
 * معناها واحد فيهم كلهم، ومحدش يقارن رقم من نافذة برقم من نافذة تانية من غير ما ياخد باله.
 */
export function AnalyticsRangePicker({
  from,
  to,
  onChange,
  idPrefix,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor={`${idPrefix}_from`}>من</Label>
        <Input
          id={`${idPrefix}_from`}
          type="date"
          value={from}
          max={to}
          onChange={(e) => onChange({ from: e.target.value, to })}
          dir="ltr"
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}_to`}>لحد</Label>
        <Input
          id={`${idPrefix}_to`}
          type="date"
          value={to}
          min={from}
          max={todayIso()}
          onChange={(e) => onChange({ from, to: e.target.value })}
          dir="ltr"
        />
      </div>
      <div className="flex gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.days}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ from: daysAgoIso(preset.days), to: todayIso() })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
