'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

// اختيار موقع حقيقي بالخريطة بدل إدخال lat/lng يدوي (كانت فجوة موثّقة في docs/16) — Leaflet +
// OpenStreetMap tiles، مفيش مفتاح API مطلوب. أيقونة الماركر الافتراضية بتاعة Leaflet بتتكسر مع
// أي bundler (مسارات صور نسبية) فبنستخدم DivIcon بسيط بلون البراند بدل كده، مش صور خارجية.
const CAIRO_CENTER: [number, number] = [30.0444, 31.2357];
const LOCATION_ZOOM = 17;

type PlaceMarker = (lat: number, lng: number, recenter?: boolean) => void;

export function MapPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);
  const placeMarkerRef = useRef<PlaceMarker | null>(null);
  const locateRef = useRef<(() => void) | null>(null);
  const onChangeRef = useRef(onChange);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;

      const hasSelectedLocation = latitude !== null && longitude !== null;
      const startLatLng: [number, number] = hasSelectedLocation ? [latitude, longitude] : CAIRO_CENTER;
      const map = L.map(containerRef.current).setView(startLatLng, 13);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({
        className: '',
        html: '<div style="width:20px;height:20px;border-radius:50%;background:#2f5aa6;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const placeMarker: PlaceMarker = (lat, lng, recenter = false) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
          markerRef.current.on('dragend', () => {
            const pos = markerRef.current!.getLatLng();
            onChangeRef.current(pos.lat, pos.lng);
          });
        }
        if (recenter) map.setView([lat, lng], LOCATION_ZOOM);
      };
      placeMarkerRef.current = placeMarker;

      locateRef.current = () => {
        if (!navigator.geolocation) {
          setLocationMessage('متصفحك لا يدعم تحديد الموقع. اختر المكان يدويًا من الخريطة.');
          return;
        }
        setIsLocating(true);
        setLocationMessage(null);
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (!mapRef.current) return;
            const { latitude: currentLat, longitude: currentLng } = position.coords;
            placeMarker(currentLat, currentLng, true);
            onChangeRef.current(currentLat, currentLng);
            setIsLocating(false);
          },
          (error) => {
            if (!mapRef.current) return;
            setIsLocating(false);
            setLocationMessage(
              error.code === error.PERMISSION_DENIED
                ? 'اسمح للموقع من المتصفح، أو اختر مكانك يدويًا على الخريطة.'
                : 'تعذر تحديد موقعك الآن. جرّب مرة أخرى أو اختره يدويًا.',
            );
          },
          { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
        );
      };

      if (hasSelectedLocation) {
        placeMarker(latitude, longitude);
      } else {
        locateRef.current();
      }

      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });
    })
      // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
      .catch((err: unknown) => console.error('فشل تحميل بيانات', err));

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      placeMarkerRef.current = null;
      locateRef.current = null;
    };
    // مقصود مرة واحدة بس وقت التركيب — تحديثات lat/lng بعد كده بتيجي من تفاعل المستخدم مع
    // الخريطة نفسها (كليك/سحب)، مش من الخارج، فمفيش داعي نعيد بناء الخريطة كل تغيّر.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (latitude !== null && longitude !== null) placeMarkerRef.current?.(latitude, longitude, true);
  }, [latitude, longitude]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={containerRef} className="h-64 w-full rounded-xl border border-border" />
        <button
          type="button"
          onClick={() => locateRef.current?.()}
          disabled={isLocating}
          className="absolute start-3 top-3 z-[1000] inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-bold text-primary shadow-lg transition hover:border-primary disabled:cursor-wait disabled:opacity-70"
        >
          <span aria-hidden="true">⌖</span>
          {isLocating ? 'بنحدد موقعك...' : 'استخدم موقعي الحالي'}
        </button>
      </div>
      <p className="text-sm text-muted">حدّد موقعك تلقائيًا، أو اضغط على الخريطة واسحب العلامة للتعديل.</p>
      {locationMessage ? <p role="status" className="text-sm text-warning">{locationMessage}</p> : null}
    </div>
  );
}
