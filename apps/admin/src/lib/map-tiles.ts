const mapboxAccessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

export type MapTileLayerConfig = {
  url: string;
  attribution: string;
  maxZoom: number;
  tileSize: number;
  zoomOffset: number;
};

// Mapbox's styles endpoint serves 512px tiles, so Leaflet needs the matching
// tile size and zoom offset to keep labels and zoom levels aligned correctly.
export const mapTileLayer: MapTileLayerConfig | null = mapboxAccessToken
  ? {
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${mapboxAccessToken}`,
      attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 22,
      tileSize: 512,
      zoomOffset: -1,
    }
  : null;

export const mapTilesConfigurationMessage = 'لم يتم إعداد مفتاح Mapbox للخريطة. أضف NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ثم أعد تشغيل لوحة الإدارة.';
