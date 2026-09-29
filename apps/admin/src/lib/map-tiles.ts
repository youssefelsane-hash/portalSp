export type MapTileLayerConfig = {
  url: string;
  attribution: string;
  maxZoom: number;
  tileSize: number;
  zoomOffset: number;
  referrerPolicy: 'strict-origin-when-cross-origin';
};

// Mapbox's styles endpoint serves 512px tiles, so Leaflet needs the matching
// tile size and zoom offset to keep labels and zoom levels aligned correctly.
export function createMapTileLayer(accessToken?: string): MapTileLayerConfig {
  const token = accessToken?.trim();
  return token ? {
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`,
      attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 22,
      tileSize: 512,
      zoomOffset: -1,
      // The admin shell intentionally uses no-referrer globally. Mapbox token
      // URL restrictions need the requesting origin, so scope this exception
      // to tile images only instead of weakening the rest of the dashboard.
      referrerPolicy: 'strict-origin-when-cross-origin',
    }
  : {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      tileSize: 256,
      zoomOffset: 0,
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
}

export const mapTileLayer = createMapTileLayer(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN);
