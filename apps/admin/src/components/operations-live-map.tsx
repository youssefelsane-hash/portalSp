'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import 'leaflet/dist/leaflet.css';

export type LiveMapTechnician = {
  id: string;
  full_name: string;
  technician_code: string;
  is_available: boolean;
  is_on_duty: boolean;
  latitude: number;
  longitude: number;
  location_updated_at: string | null;
};

export type LiveMapOrder = {
  id: string;
  order_number: string;
  service_name: string;
  status: string;
  scheduled_at: string | null;
  technician_id: string | null;
  latitude: number;
  longitude: number;
};

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const CAIRO_FALLBACK: [number, number] = [30.0444, 31.2357];

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]!));
}

function readableLocationAge(value: string | null): string {
  if (!value) return 'وقت التحديث غير معروف';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return 'محدّث الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  return `منذ ${Math.floor(minutes / 60)} ساعة`;
}

/**
 * طبقة الخريطة معزولة عن صفحة البيانات حتى لا يعاد تركيب Leaflet مع كل refresh. نعيد رسم layers
 * فقط؛ ده يحافظ على zoom وموضع الأدمن لو بيتابع نقطة بعينها.
 */
export function OperationsLiveMap({ technicians, orders }: { technicians: LiveMapTechnician[]; orders: LiveMapOrder[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layersRef = useRef<import('leaflet').LayerGroup | null>(null);
  const firstFitRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    import('leaflet')
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, { zoomControl: true }).setView(CAIRO_FALLBACK, 11);
        L.tileLayer(OSM_TILE_URL, { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
        mapRef.current = map;
      })
      .catch((error: unknown) => console.error('فشل تحميل الخريطة الحية', error));

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const map = mapRef.current;
    if (!map) return;

    void import('leaflet').then((L) => {
      if (cancelled || !mapRef.current) return;
      layersRef.current?.remove();
      const layers = L.layerGroup().addTo(map);
      layersRef.current = layers;
      const technicianById = new Map(technicians.map((technician) => [technician.id, technician]));
      const points: [number, number][] = [];

      for (const order of orders) {
        const point: [number, number] = [order.latitude, order.longitude];
        points.push(point);
        const technician = order.technician_id ? technicianById.get(order.technician_id) : undefined;
        if (technician) {
          L.polyline([[technician.latitude, technician.longitude], point], {
            color: '#0f766e',
            weight: 2,
            opacity: 0.65,
            dashArray: '6 7',
          }).addTo(layers);
        }
        L.circleMarker(point, {
          radius: 8,
          color: '#b45309',
          fillColor: '#f59e0b',
          fillOpacity: 0.95,
          weight: 2,
        })
          .bindPopup(`<div dir="rtl"><strong>طلب ${escapeHtml(order.order_number)}</strong><br/>${escapeHtml(order.service_name)}<br/><small>${escapeHtml(order.status)}</small><br/><a href="/orders/${order.id}">فتح الطلب</a></div>`)
          .addTo(layers);
      }

      for (const technician of technicians) {
        const point: [number, number] = [technician.latitude, technician.longitude];
        points.push(point);
        const color = technician.is_on_duty ? '#166534' : technician.is_available ? '#1d4ed8' : '#64748b';
        L.circleMarker(point, {
          radius: technician.is_on_duty ? 9 : 7,
          color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindPopup(`<div dir="rtl"><strong>${escapeHtml(technician.full_name)}</strong><br/><small>${escapeHtml(technician.technician_code)} · ${readableLocationAge(technician.location_updated_at)}</small><br/><a href="/technicians/${technician.id}">فتح ملف الفني</a></div>`)
          .addTo(layers);
      }

      if (firstFitRef.current && points.length > 0) {
        firstFitRef.current = false;
        map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [technicians, orders]);

  return <div ref={containerRef} className="h-[62vh] min-h-[34rem] w-full rounded-xl border" style={{ zIndex: 0 }} />;
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span><i className="ml-1 inline-block size-2 rounded-full bg-green-700" />فني على رأس العمل</span>
      <span><i className="ml-1 inline-block size-2 rounded-full bg-blue-700" />فني متاح</span>
      <span><i className="ml-1 inline-block size-2 rounded-full bg-slate-500" />فني غير متاح</span>
      <span><i className="ml-1 inline-block size-2 rounded-full bg-amber-500" />طلب تشغيلي</span>
      <span><i className="ml-1 inline-block h-px w-4 bg-teal-700 align-middle" />صلة فني بطلبه</span>
    </div>
  );
}
