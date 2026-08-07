// الشكل اللي TypeORM بيتوقعه لأعمدة geography(Point/Polygon) — بيتحول لـ
// ST_GeomFromGeoJSON(...) تلقائياً وقت الكتابة، وST_AsGeoJSON(...) وقت القراءة.
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}
