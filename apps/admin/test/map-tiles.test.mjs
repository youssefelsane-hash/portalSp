import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapTileLayer } from '../src/lib/map-tiles.ts';

test('absent or empty Mapbox token uses attributed keyless interactive tiles', () => {
  for (const token of [undefined, '', '   ']) {
    const config = createMapTileLayer(token);
    assert.equal(config.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    assert.equal(config.tileSize, 256);
    assert.equal(config.zoomOffset, 0);
    assert.equal(config.maxZoom, 19);
    assert.match(config.attribution, /openstreetmap.org\/copyright/);
    assert.equal(config.referrerPolicy, 'strict-origin-when-cross-origin');
  }
});

test('configured Mapbox keeps its retina scale, attribution and allowed-origin Referer', () => {
  const config = createMapTileLayer('  pk.test-token  ');
  assert.match(config.url, /access_token=pk.test-token$/);
  assert.equal(config.tileSize, 512);
  assert.equal(config.zoomOffset, -1);
  assert.equal(config.maxZoom, 22);
  assert.match(config.attribution, /mapbox.com/);
  assert.equal(config.referrerPolicy, 'strict-origin-when-cross-origin');
});
