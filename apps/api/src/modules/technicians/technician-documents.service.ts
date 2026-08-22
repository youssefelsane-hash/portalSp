import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { safeExtensionForFile } from '../../common/storage/file-signature-validator';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { uploadWithOrphanCleanup } from '../../common/storage/upload-with-orphan-cleanup.util';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { TechnicianDocument, TechnicianDocumentType } from './entities/technician-document.entity';
import { TechniciansService } from './technicians.service';

export interface IncomingFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class TechnicianDocumentsService {
  constructor(
    @InjectRepository(TechnicianDocument) private readonly documents: Repository<TechnicianDocument>,
    private readonly techniciansService: TechniciansService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async upload(userId: string, dto: UploadDocumentDto, file: IncomingFile): Promise<TechnicianDocument> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);

    const key = `technician-documents/${profile.id}/${randomUUID()}${safeExtensionForFile(file.buffer)}`;
    return uploadWithOrphanCleanup(this.storage, key, file.buffer, file.mimetype, (fileUrl) => {
      const document = this.documents.create({
        technicianId: profile.id,
        documentType: dto.document_type,
        fileUrl,
        storageKey: key,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        expiresAt: dto.expires_at ?? null,
      });
      return this.documents.save(document);
    });
  }

  async listMine(userId: string): Promise<TechnicianDocument[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.listForTechnician(profile.id);
  }

  listForTechnician(technicianId: string): Promise<TechnicianDocument[]> {
    return this.documents.find({ where: { technicianId }, order: { createdAt: 'DESC' } });
  }

  /**
   * أحدث مستند من نوع معيّن، بغض النظر عن حالة المراجعة (ADR-0031) — مستخدمة عشان الفني يشوف
   * آخر صورة رفعها هو نفسه فورًا في بروفايله (GET /technician/me)، حتى قبل ما الأدمن يعتمدها.
   * مصدر منفصل تمامًا عن users.avatar_storage_key (المصدر المعتمد للعميل، بعد الاعتماد بس).
   */
  async findLatestOfType(technicianId: string, documentType: TechnicianDocumentType): Promise<TechnicianDocument | null> {
    return this.documents.findOne({ where: { technicianId, documentType }, order: { createdAt: 'DESC' } });
  }

  async findOwnedByTechnicianOrThrow(technicianId: string, documentId: string): Promise<TechnicianDocument> {
    const document = await this.documents.findOne({ where: { id: documentId, technicianId } });
    if (!document) {
      throw new ApiException(ErrorCode.VAL_001, 'المستند غير موجود', HttpStatus.NOT_FOUND);
    }
    return document;
  }
}
