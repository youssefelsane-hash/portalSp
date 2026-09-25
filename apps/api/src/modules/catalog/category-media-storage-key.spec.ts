jest.mock('../branding/branding-file-validator', () => ({
  BrandingFileValidationError: class BrandingFileValidationError extends Error {},
  validateBrandingFile: jest.fn(),
}));

import { AdminCatalogService } from './admin-catalog.service';
import { toAdminServiceCategoryResponseDto } from './dto/admin-catalog-response.dto';
import { toServiceCategoryResponseDto } from './dto/service-response.dto';
import { ServiceCategory } from './entities/service-category.entity';
import { StorageService } from '../../common/storage/storage.service';

describe('Service-category R2 media', () => {
  const category = (): ServiceCategory => ({
    id: 'category-1',
    parentCategoryId: null,
    nameAr: 'سباكة',
    nameEn: 'Plumbing',
    slug: 'plumbing',
    descriptionAr: null,
    iconUrl: 'https://r2.example/expired-icon-url',
    iconStorageKey: null,
    coverImageUrl: 'https://r2.example/expired-cover-url',
    coverImageStorageKey: null,
    displayOrder: 1,
    isActive: true,
    isFeatured: false,
    launchPhase: 1,
    createdAt: new Date('2026-09-22T00:00:00Z'),
    updatedAt: new Date('2026-09-22T00:00:00Z'),
    deletedAt: null,
  });

  const freshStorage = (): StorageService => ({
    save: jest.fn().mockResolvedValue('https://r2.example/upload-response-url'),
    delete: jest.fn(),
    getUrl: jest.fn(async (key: string) => `https://r2.example/fresh/${key}`),
  });

  it('resolves icon and cover keys to fresh URLs for public and admin responses', async () => {
    const row = category();
    row.iconStorageKey = 'service-categories/category-1/icon/icon.jpg';
    row.coverImageStorageKey = 'service-categories/category-1/cover/cover.jpg';
    const storage = freshStorage();

    const [publicDto, adminDto] = await Promise.all([
      toServiceCategoryResponseDto(row, storage),
      toAdminServiceCategoryResponseDto(row, storage),
    ]);

    expect(publicDto.icon_url).toBe('https://r2.example/fresh/service-categories/category-1/icon/icon.jpg');
    expect(publicDto.cover_image_url).toBe('https://r2.example/fresh/service-categories/category-1/cover/cover.jpg');
    expect(adminDto).toMatchObject({ icon_url: publicDto.icon_url, cover_image_url: publicDto.cover_image_url });
  });

  it('keeps external and legacy URLs as fallback when no storage key exists', async () => {
    const storage = freshStorage();
    const dto = await toServiceCategoryResponseDto(category(), storage);

    expect(dto.icon_url).toBe('https://r2.example/expired-icon-url');
    expect(dto.cover_image_url).toBe('https://r2.example/expired-cover-url');
    expect(storage.getUrl).not.toHaveBeenCalled();
  });

  it('stores the generated key on upload, clears it on delete, and removes it when a manual URL replaces the asset', async () => {
    const row = category();
    const categories = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn(async (value: ServiceCategory) => value),
    };
    const storage = freshStorage();
    const service = new AdminCatalogService(
      categories as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, { record: jest.fn() } as never, storage,
    );

    await service.uploadCategoryMedia('admin-1', row.id, 'icon', {
      buffer: Buffer.from('image'), mimetype: 'image/png', size: 5,
    });
    expect(row.iconUrl).toBe('https://r2.example/upload-response-url');
    expect(row.iconStorageKey).toMatch(/^service-categories\/category-1\/icon\//);

    await service.clearCategoryMedia('admin-1', row.id, 'icon');
    expect(row.iconUrl).toBeNull();
    expect(row.iconStorageKey).toBeNull();

    row.coverImageStorageKey = 'service-categories/category-1/cover/old.jpg';
    await service.updateCategory('admin-1', row.id, { cover_image_url: 'https://cdn.example/manual-cover.jpg' });
    expect(row.coverImageUrl).toBe('https://cdn.example/manual-cover.jpg');
    expect(row.coverImageStorageKey).toBeNull();
  });
});
