'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// اختيار موقع حقيقي بالخريطة بدل إدخال lat/lng يدوي (كانت فجوة موثّقة في docs/16) — Leaflet +
// OpenStreetMap tiles، مفيش مفتاح API مطلوب. أيقونة الماركر الافتراضية بتاعة Leaflet بتتكسر مع
// أي bundler (مسارات صور نسبية) فبنستخدم DivIcon بسيط بلون البراند بدل كده، مش صور خارجية.
const CAIRO_CENTER: [number, number] = [30.0444, 31.2357];

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
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;

      const startLatLng: [number, number] = latitude !== null && longitude !== null ? [latitude, longitude] : CAIRO_CENTER;
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

      const placeMarker = (lat: number, lng: number) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
          markerRef.current.on('dragend', () => {
            const pos = markerRef.current!.getLatLng();
            onChangeRef.current(pos.lat, pos.lng);
          });
        }
      };

      if (latitude !== null && longitude !== null) placeMarker(latitude, longitude);

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
    };
    // مقصود مرة واحدة بس وقت التركيب — تحديثات lat/lng بعد كده بتيجي من تفاعل المستخدم مع
    // الخريطة نفسها (كليك/سحب)، مش من الخارج، فمفيش داعي نعيد بناء الخريطة كل تغيّر.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div ref={containerRef} className="h-64 w-full rounded-xl border border-border" />
      <p className="mt-1 text-sm text-muted">دوس على مكانك بالظبط على الخريطة، أو اسحب العلامة</p>
    </div>
  );
}
