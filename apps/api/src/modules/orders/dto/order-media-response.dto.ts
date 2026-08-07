import { OrderMedia } from '../entities/order-media.entity';

export interface OrderMediaResponseDto {
  id: string;
  media_type: string;
  file_url: string;
  caption: string | null;
  taken_at: string;
}

export function toOrderMediaResponseDto(media: OrderMedia): OrderMediaResponseDto {
  return {
    id: media.id,
    media_type: media.mediaType,
    file_url: media.fileUrl,
    caption: media.caption,
    taken_at: media.takenAt.toISOString(),
  };
}
