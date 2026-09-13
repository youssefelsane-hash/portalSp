import { DEFAULT_BRANDING_ASSETS } from './branding-defaults';
import { BrandingAssetType } from './entities/branding-asset.entity';

describe('branding defaults', () => {
  it('keeps a complete fallback for every public asset type', () => {
    expect(Object.keys(DEFAULT_BRANDING_ASSETS).sort()).toEqual(Object.values(BrandingAssetType).sort());

    for (const fallback of Object.values(DEFAULT_BRANDING_ASSETS)) {
      expect(fallback.url).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(fallback.width_px).toBeGreaterThanOrEqual(32);
      expect(fallback.height_px).toBeGreaterThanOrEqual(32);
    }
  });

  it('ships the compact mark as a real OSTA fallback, not an empty placeholder', () => {
    const encoded = DEFAULT_BRANDING_ASSETS[BrandingAssetType.LOGO_MARK].url.split(',')[1];
    const svg = Buffer.from(encoded, 'base64').toString('utf8');

    expect(svg).toContain('#153f38');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain('<text');
  });
});
