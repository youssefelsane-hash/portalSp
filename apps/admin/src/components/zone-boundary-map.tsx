'use client';

import { useEffect, useRef, useState } from 'react';
import type { LngLatPoint } from '@baytak/shared-types';
import { Button } from '@/components/ui/button';
import 'leaflet/dist/leaflet.css';

// خرائط OpenStreetMap مجانية بالكامل (بلاطات tile مفتوحة، مش محتاجة API key زي Google Maps) —
// مناسبة تماماً للوحة رسم داخلية في apps/admin. تفاصيل خيارات الخرائط التانية (لو احتجنا Google
// Maps فعلي لاحقاً) موثّقة في docs/03-external-integrations.md.
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: [number, number] = [30.0444, 31.2357]; // القاهرة، fallback لو المدينة معندهاش مركز محفوظ

interface ZoneBoundaryMapProps {
  center: { lat: number; lng: number } | null;
  initialPoints: LngLatPoint[] | null;
  isSaving: boolean;
  onSave: (points: LngLatPoint[]) => Promise<void>;
  onCancel: () => void;
}

export function ZoneBoundaryMap({ center, initialPoints, isSaving, onSave, onCancel }: ZoneBoundaryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<{ polygon: any; markers: any[] } | null>(null);
  const [points, setPoints] = useState<LngLatPoint[]>(initialPoints ?? []);

  // بنسيب الرسم نفسه (الليّر) في ref عادي بدل ما يدخل الـ state عشان مانعملش re-render للخريطة
  // كلها مع كل نقطة — بس بنعمل re-render لباقي الواجهة (عدّاد النقط/أزرار الحفظ) عبر `points` state.
  useEffect(() => {
    let cancelled = false;
    let map: import('leaflet').Map | null = null;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;

      const startCenter: [number, number] = center ? [center.lat, center.lng] : DEFAULT_CENTER;
      map = L.map(containerRef.current).setView(startCenter, 12);
      mapRef.current = map;

      L.tileLayer(OSM_TILE_URL, {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const redraw = (pts: LngLatPoint[]) => {
        if (layerRef.current) {
          layerRef.current.polygon?.remove();
          layerRef.current.markers.forEach((m) => m.remove());
        }
        const latLngs = pts.map((p): [number, number] => [p.lat, p.lng]);
        const polygon = pts.length >= 2 ? L.polygon(latLngs, { color: '#2563eb' }).addTo(map!) : null;
        const markers = pts.map((p) =>
          L.circleMarker([p.lat, p.lng], { radius: 5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1 }).addTo(map!),
        );
        layerRef.current = { polygon, markers };
        if (pts.length > 0) {
          const bounds = L.latLngBounds(latLngs);
          map!.fitBounds(bounds, { maxZoom: 16, padding: [40, 40] });
        }
      };

      redraw(initialPoints ?? []);

      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        setPoints((prev) => {
          const next = [...prev, { lng: e.latlng.lng, lat: e.latlng.lat }];
          redraw(next);
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function undoLast() {
    setPoints((prev) => {
      const next = prev.slice(0, -1);
      redrawFromState(next);
      return next;
    });
  }

  function clearAll() {
    setPoints(() => {
      redrawFromState([]);
      return [];
    });
  }

  // بننادي دالة الرسم من بره الـ closure الأصلي بتاع useEffect لأزرار "تراجع"/"مسح" — بنعيد
  // بناء نفس منطق الرسم هنا بدل ما نصدّره، عشان نفضل من غير مكتبة state management زيادة.
  function redrawFromState(pts: LngLatPoint[]) {
    const map = mapRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      if (layerRef.current) {
        layerRef.current.polygon?.remove();
        layerRef.current.markers.forEach((m) => m.remove());
      }
      const latLngs = pts.map((p): [number, number] => [p.lat, p.lng]);
      const polygon = pts.length >= 2 ? L.polygon(latLngs, { color: '#2563eb' }).addTo(map) : null;
      const markers = pts.map((p) =>
        L.circleMarker([p.lat, p.lng], { radius: 5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1 }).addTo(map),
      );
      layerRef.current = { polygon, markers };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        دوس على الخريطة عشان تضيف نقط المضلّع بالترتيب (لازم 3 نقط على الأقل). الخط بيتقفل تلقائياً
        بين آخر نقطة والأولى وقت الحفظ.
      </p>
      <div ref={containerRef} className="h-96 w-full rounded-md border" style={{ zIndex: 0 }} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{points.length} نقطة</span>
        <Button type="button" size="sm" variant="outline" disabled={points.length === 0} onClick={undoLast}>
          تراجع عن آخر نقطة
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={points.length === 0} onClick={clearAll}>
          مسح الكل
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={points.length < 3 || isSaving}
          onClick={() => onSave(points)}
        >
          حفظ المضلّع
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isSaving} onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
