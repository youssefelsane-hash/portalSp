import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { safeExtensionForFile } from '../../common/storage/file-signature-validator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { uploadWithOrphanCleanup } from '../../common/storage/upload-with-orphan-cleanup.util';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { IncomingFile } from './order-media.service';

export interface ProblemImageUploadResponse {
  id: string;
  file_url: string;
  mime_type: string;
  file_size_bytes: number;
  expires_at: string;
}

@Injectable()
export class ProblemImagesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async upload(userId: string, serviceId: string, file: IncomingFile): Promise<ProblemImageUploadResponse> {
    const customer = await this.customerProfiles.findByUserIdOrThrow(userId);
    const [service] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM services WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
      [serviceId],
    );
    if (!service) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة أو غير متاحة', HttpStatus.BAD_REQUEST);
    }

    const key = `problem-images/${customer.id}/${serviceId}/${randomUUID()}${safeExtensionForFile(file.buffer)}`;
    return uploadWithOrphanCleanup(this.storage, key, file.buffer, file.mimetype, async (fileUrl) => {
      const [row] = await this.dataSource.query<
        {
          id: string;
          file_url: string;
          mime_type: string;
          file_size_bytes: number;
          expires_at: Date;
        }[]
      >(
        `INSERT INTO order_problem_image_uploads
           (customer_id, service_id, storage_key, file_url, mime_type, file_size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, file_url, mime_type, file_size_bytes, expires_at`,
        [customer.id, serviceId, key, fileUrl, file.mimetype, file.size],
      );
      return {
        id: row.id,
        file_url: await this.storage.getUrl(key),
        mime_type: row.mime_type,
        file_size_bytes: Number(row.file_size_bytes),
        expires_at: new Date(row.expires_at).toISOString(),
      };
    });
  }
}
