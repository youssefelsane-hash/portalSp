import { StorageService } from '../../../common/storage/storage.service';
import { OrderMedia } from '../entities/order-media.entity';

export interface OrderMediaResponseDto {
  id: string;
  media_type: string;
  file_url: string;
  caption: string | null;
  taken_at: string;
}

// docs/08 §19 بند 9 — لو storageKey موجود (رفع بعد الإصلاح)، رابط طازة بيتولّد وقت كل قراءة
// (getUrl(key)) بدل file_url الثابت اللي بينتهي بعد 7 أيام مع S3. صف قديم قبل الإصلاح
// (storageKey=null) بيستخدم file_url المخزّن زي ما هو — مفيش key أصلي متسجّل ليه نولّد منه.
export async function toOrderMediaResponseDto(media: OrderMedia, storage: StorageService): Promise<OrderMediaResponseDto> {
  return {
    id: media.id,
    media_type: media.mediaType,
    file_url: media.storageKey ? await storage.getUrl(media.storageKey) : media.fileUrl,
    caption: media.caption,
    taken_at: media.takenAt.toISOString(),
  };
}
