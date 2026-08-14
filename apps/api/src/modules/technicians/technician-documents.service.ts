import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { TechnicianDocument } from './entities/technician-document.entity';
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

    const key = `technician-documents/${profile.id}/${randomUUID()}${extname(file.originalname)}`;
    const fileUrl = await this.storage.save(key, file.buffer, file.mimetype);

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
  }

  async listMine(userId: string): Promise<TechnicianDocument[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.listForTechnician(profile.id);
  }

  listForTechnician(technicianId: string): Promise<TechnicianDocument[]> {
    return this.documents.find({ where: { technicianId }, order: { createdAt: 'DESC' } });
  }

  async findOwnedByTechnicianOrThrow(technicianId: string, documentId: string): Promise<TechnicianDocument> {
    const document = await this.documents.findOne({ where: { id: documentId, technicianId } });
    if (!document) {
      throw new ApiException(ErrorCode.VAL_001, 'المستند غير موجود', HttpStatus.NOT_FOUND);
    }
    return document;
  }
}
