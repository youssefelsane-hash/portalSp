import { StorageService } from './storage.service';
import { uploadWithOrphanCleanup } from './upload-with-orphan-cleanup.util';

// Script 2 Part G (findings #34/#35) — رفع الملف نجح، تسجيل الـmetadata فشل، لازم:
// (1) الملف يتحاول يتمسح تعويضًا، (2) نفس الخطأ الأصلي يترمي زي ما هو للكولر (مش يتغطى).
describe('uploadWithOrphanCleanup — Script 2 Part G', () => {
  function storage(overrides?: Partial<StorageService>): StorageService {
    return {
      save: jest.fn(async (key: string) => `https://example.com/${key}`),
      getUrl: jest.fn(async (key: string) => `https://example.com/${key}`),
      delete: jest.fn(async () => undefined),
      ...overrides,
    };
  }

  it('بترجع نتيجة persistMetadata عادي، من غير ما تلمس storage.delete لو كله نجح', async () => {
    const s = storage();
    const result = await uploadWithOrphanCleanup(s, 'orders/1/x.jpg', Buffer.from('img'), 'image/jpeg', async (fileUrl) => ({
      id: 'row-1',
      fileUrl,
    }));

    expect(result).toEqual({ id: 'row-1', fileUrl: 'https://example.com/orders/1/x.jpg' });
    expect(s.delete).not.toHaveBeenCalled();
  });

  it('لو persistMetadata فشلت، بتتمسح الملف وتعيد رمي الخطأ الأصلي زي ما هو', async () => {
    const s = storage();
    const dbError = new Error('DB عابر أثناء تسجيل الـmetadata');

    await expect(
      uploadWithOrphanCleanup(s, 'orders/1/x.jpg', Buffer.from('img'), 'image/jpeg', async () => {
        throw dbError;
      }),
    ).rejects.toThrow(dbError);

    expect(s.delete).toHaveBeenCalledWith('orders/1/x.jpg');
    expect(s.delete).toHaveBeenCalledTimes(1);
  });

  it('لو حذف الملف اليتيم نفسه فشل، برضه بيرجع نفس خطأ الـDB الأصلي (مش خطأ الحذف)', async () => {
    const s = storage({ delete: jest.fn(async () => undefined) }); // delete() نفسها ما بترميش أبدًا (نفس عقد الواجهة)
    const dbError = new Error('DB عابر');

    await expect(
      uploadWithOrphanCleanup(s, 'orders/1/x.jpg', Buffer.from('img'), 'image/jpeg', async () => {
        throw dbError;
      }),
    ).rejects.toThrow('DB عابر');
  });

  it('save() نفسها لو فشلت، مفيش delete() هيتنادى خالص (مفيش حاجة اترفعت أصلاً)', async () => {
    const s = storage({ save: jest.fn(async () => { throw new Error('S3 غير متاح'); }) });

    await expect(
      uploadWithOrphanCleanup(s, 'orders/1/x.jpg', Buffer.from('img'), 'image/jpeg', async () => ({ id: 'row-1' })),
    ).rejects.toThrow('S3 غير متاح');

    expect(s.delete).not.toHaveBeenCalled();
  });
});
