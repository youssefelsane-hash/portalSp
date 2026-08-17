import { toOrderMediaResponseDto } from '../../modules/orders/dto/order-media-response.dto';
import { OrderMedia, OrderMediaType } from '../../modules/orders/entities/order-media.entity';
import { toTechnicianDocumentResponseDto } from '../../modules/technicians/dto/technician-document-response.dto';
import { DocumentReviewStatus, TechnicianDocument, TechnicianDocumentType } from '../../modules/technicians/entities/technician-document.entity';
import { toComplaintAttachmentResponseDto } from '../../modules/support/dto/complaint-attachment-response.dto';
import { ComplaintAttachment } from '../../modules/support/entities/complaint-attachment.entity';
import { StorageService } from './storage.service';

// اختبار وحدة نقي (بدون DB) — بيثبت تعميم نمط getUrl(key) (docs/08 §19 بند 9) على التلات
// جداول اللي كانت فجوة موثّقة صراحة في s3-storage.service.ts نفسها: order_media،
// technician_documents، complaint_attachments. الثلاثة بيتبعوا نفس القاعدة بالحرف — صف عنده
// storage_key (اترفع بعد الإصلاح) بياخد رابط طازة من storage.getUrl(key) وقت كل قراءة، صف
// قديم (storage_key=null، اترفع قبل الإصلاح) بيستخدم file_url المخزّن زي ما هو (مفيش key أصلي
// نولّد منه).
describe('getUrl(key) — تعميم النمط على order_media/technician_documents/complaint_attachments', () => {
  function fakeStorage(expectedKey: string, freshUrl: string): StorageService {
    return {
      save: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn(async (key: string) => {
        expect(key).toBe(expectedKey);
        return freshUrl;
      }),
    };
  }

  describe('order_media', () => {
    const base: OrderMedia = {
      id: 'm1',
      orderId: 'o1',
      ratingId: null,
      uploadedByUserId: 'u1',
      mediaType: OrderMediaType.BEFORE_PHOTO,
      fileUrl: 'https://s3.example.com/expired-presigned-url',
      storageKey: null,
      fileSizeBytes: 100,
      caption: null,
      takenAt: new Date('2026-08-14T00:00:00Z'),
      location: null,
      createdAt: new Date('2026-08-14T00:00:00Z'),
    };

    it('storageKey موجود — بيولّد رابط طازة عبر storage.getUrl(key)', async () => {
      const media = { ...base, storageKey: 'orders/o1/photo.jpg' };
      const storage = fakeStorage('orders/o1/photo.jpg', 'https://s3.example.com/fresh-url');
      const dto = await toOrderMediaResponseDto(media, storage);
      expect(dto.file_url).toBe('https://s3.example.com/fresh-url');
      expect(storage.getUrl).toHaveBeenCalledTimes(1);
    });

    it('storageKey=null (صف قديم قبل الإصلاح) — بيستخدم file_url المخزّن زي ما هو، مفيش نداء لـstorage', async () => {
      const storage = fakeStorage('never-called', 'never-used');
      const dto = await toOrderMediaResponseDto(base, storage);
      expect(dto.file_url).toBe('https://s3.example.com/expired-presigned-url');
      expect(storage.getUrl).not.toHaveBeenCalled();
    });
  });

  describe('technician_documents', () => {
    const base: TechnicianDocument = {
      id: 'd1',
      technicianId: 't1',
      documentType: TechnicianDocumentType.NATIONAL_ID_FRONT,
      fileUrl: 'https://s3.example.com/expired-doc-url',
      storageKey: null,
      fileSizeBytes: 100,
      mimeType: 'image/jpeg',
      reviewStatus: DocumentReviewStatus.PENDING,
      rejectionReason: null,
      reviewedByUserId: null,
      reviewedAt: null,
      expiresAt: null,
      createdAt: new Date('2026-08-14T00:00:00Z'),
      updatedAt: new Date('2026-08-14T00:00:00Z'),
      deletedAt: null,
    };

    it('storageKey موجود — رابط طازة', async () => {
      const document = { ...base, storageKey: 'technician-documents/t1/id-front.jpg' };
      const storage = fakeStorage('technician-documents/t1/id-front.jpg', 'https://s3.example.com/fresh-doc-url');
      const dto = await toTechnicianDocumentResponseDto(document, storage);
      expect(dto.file_url).toBe('https://s3.example.com/fresh-doc-url');
    });

    it('storageKey=null — file_url القديم زي ما هو', async () => {
      const storage = fakeStorage('never-called', 'never-used');
      const dto = await toTechnicianDocumentResponseDto(base, storage);
      expect(dto.file_url).toBe('https://s3.example.com/expired-doc-url');
      expect(storage.getUrl).not.toHaveBeenCalled();
    });
  });

  describe('complaint_attachments', () => {
    const base: ComplaintAttachment = {
      id: 'a1',
      complaintId: 'c1',
      fileUrl: 'https://s3.example.com/expired-attachment-url',
      storageKey: null,
      fileType: 'image/jpeg',
      uploadedByUserId: 'u1',
      createdAt: new Date('2026-08-14T00:00:00Z'),
    };

    it('storageKey موجود — رابط طازة', async () => {
      const attachment = { ...base, storageKey: 'complaints/c1/photo.jpg' };
      const storage = fakeStorage('complaints/c1/photo.jpg', 'https://s3.example.com/fresh-attachment-url');
      const dto = await toComplaintAttachmentResponseDto(attachment, storage);
      expect(dto.file_url).toBe('https://s3.example.com/fresh-attachment-url');
    });

    it('storageKey=null — file_url القديم زي ما هو', async () => {
      const storage = fakeStorage('never-called', 'never-used');
      const dto = await toComplaintAttachmentResponseDto(base, storage);
      expect(dto.file_url).toBe('https://s3.example.com/expired-attachment-url');
      expect(storage.getUrl).not.toHaveBeenCalled();
    });
  });
});
