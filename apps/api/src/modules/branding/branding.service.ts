import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { validateBrandingFile, BrandingFileValidationError } from './branding-file-validator';
import { DEFAULT_BRANDING_ASSETS } from './branding-defaults';
import { BrandingAsset, BrandingAssetType } from './entities/branding-asset.entity';
import {
  AdminBrandingPayloadDto,
  BrandingPayloadDto,
  toAdminBrandingAssetResponseDto,
} from './dto/branding-response.dto';

export interface IncomingBrandingFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const PUBLIC_CACHE_KEY = 'branding:public-payload';
const PUBLIC_CACHE_TTL_SECONDS = 300; // 5 دقايق — كاش-أول، القاعدة/التخزين مصدر الحقيقة (نفس فلسفة SettingsService)

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    @InjectRepository(BrandingAsset) private readonly assets: Repository<BrandingAsset>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly cache: RedisCacheService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * الاستهلاك العام (`GET /branding`، Customer/Technician/Admin apps) — **أبدًا ميرميش استثناء**،
   * أي فشل (DB/Redis/تخزين واقع) بيترجع fallback الكامل مع تحذير في اللوج بس (ADR-0014).
   */
  async getPublicPayload(): Promise<BrandingPayloadDto> {
    try {
      const cached = await this.cache.get(PUBLIC_CACHE_KEY);
      if (cached) {
        try {
          return JSON.parse(cached) as BrandingPayloadDto;
        } catch {
          // كاش فاسد — تجاهله وابني من القاعدة تحت
        }
      }

      const payload = await this.buildPayload();
      await this.cache.set(PUBLIC_CACHE_KEY, JSON.stringify(payload), PUBLIC_CACHE_TTL_SECONDS);
      return payload;
    } catch (err) {
      this.logger.warn(`فشل بناء البراندنج، رجّعنا fallback الافتراضي: ${err instanceof Error ? err.message : err}`);
      return this.buildFallbackPayload();
    }
  }

  /** نفس البيانات + تفاصيل إدارية إضافية (مين رفع، امتى) — للوحة الأدمن، `GET /admin/branding`. */
  async getAdminPayload(): Promise<AdminBrandingPayloadDto> {
    const rows = await this.assets.find();
    const byType = new Map(rows.map((r) => [r.assetType, r]));

    const result = {} as AdminBrandingPayloadDto;
    for (const assetType of Object.values(BrandingAssetType)) {
      const row = byType.get(assetType) ?? null;
      const fallback = DEFAULT_BRANDING_ASSETS[assetType];
      const url = row ? await this.storage.getUrl(row.storageKey) : fallback.url;
      result[assetType] = toAdminBrandingAssetResponseDto(assetType, row, url, fallback.width_px, fallback.height_px);
    }
    return result;
  }

  private async buildPayload(): Promise<BrandingPayloadDto> {
    const rows = await this.assets.find();
    const byType = new Map(rows.map((r) => [r.assetType, r]));

    const result = {} as BrandingPayloadDto;
    for (const assetType of Object.values(BrandingAssetType)) {
      const row = byType.get(assetType) ?? null;
      const fallback = DEFAULT_BRANDING_ASSETS[assetType];
      const url = row ? await this.storage.getUrl(row.storageKey) : fallback.url;
      result[assetType] = {
        asset_type: assetType,
        url,
        width_px: row?.widthPx ?? fallback.width_px,
        height_px: row?.heightPx ?? fallback.height_px,
        is_default: !row,
      };
    }
    return result;
  }

  private buildFallbackPayload(): BrandingPayloadDto {
    const result = {} as BrandingPayloadDto;
    for (const assetType of Object.values(BrandingAssetType)) {
      const fallback = DEFAULT_BRANDING_ASSETS[assetType];
      result[assetType] = {
        asset_type: assetType,
        url: fallback.url,
        width_px: fallback.width_px,
        height_px: fallback.height_px,
        is_default: true,
      };
    }
    return result;
  }

  /**
   * رفع/استبدال أصل براندنج (ADR-0014) — تحقق كامل من الملف (magic bytes + أبعاد + حجم)، رفع
   * لمفتاح جديد كليًا (الملف القديم يفضل موجود في التخزين، مش بيتمسح فورًا)، تحديث/إنشاء الصف،
   * إبطال الكاش العام فورًا، Audit كامل. Idempotent بمعنى: رفعتين متتاليتين = آخر واحدة بس اللي فاعلة.
   */
  async upload(
    adminUserId: string,
    assetType: BrandingAssetType,
    file: IncomingBrandingFile,
    meta?: AuditActorMeta,
  ): Promise<BrandingAsset> {
    let dimensions: { widthPx: number; heightPx: number };
    try {
      dimensions = validateBrandingFile(file.buffer, file.mimetype, file.size);
    } catch (err) {
      if (err instanceof BrandingFileValidationError) {
        throw new ApiException(ErrorCode.VAL_001, err.message, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }

    const key = `branding/${assetType}/${randomUUID()}`;
    await this.storage.save(key, file.buffer, file.mimetype);

    const existing = await this.assets.findOne({ where: { assetType } });
    const previousValues = existing
      ? { storage_key: existing.storageKey, mime_type: existing.mimeType, width_px: existing.widthPx, height_px: existing.heightPx }
      : null;

    const saved = await this.assets.save(
      this.assets.create({
        id: existing?.id,
        assetType,
        storageKey: key,
        mimeType: file.mimetype,
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
        fileSizeBytes: file.size,
        originalFileName: file.originalname,
        uploadedByUserId: adminUserId,
      }),
    );

    await this.cache.del(PUBLIC_CACHE_KEY);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'branding.asset_uploaded',
      entityType: 'branding_asset',
      entityId: saved.id,
      oldValues: previousValues,
      newValues: {
        asset_type: assetType,
        storage_key: key,
        mime_type: file.mimetype,
        width_px: dimensions.widthPx,
        height_px: dimensions.heightPx,
        file_size_bytes: file.size,
      },
      meta,
    });

    return saved;
  }

  /** رجوع للـfallback الافتراضي — بيمسح الصف بس (دفاعي: الملف الفعلي في التخزين مش بيتمسح). */
  async remove(adminUserId: string, assetType: BrandingAssetType, meta?: AuditActorMeta): Promise<void> {
    const existing = await this.assets.findOne({ where: { assetType } });
    if (!existing) {
      return; // idempotent — أصلاً مفيش حاجة مرفوعة، رجوع للـfallback بلا أي أثر
    }

    await this.assets.delete({ assetType });
    await this.cache.del(PUBLIC_CACHE_KEY);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'branding.asset_removed',
      entityType: 'branding_asset',
      entityId: existing.id,
      oldValues: { asset_type: assetType, storage_key: existing.storageKey },
      newValues: null,
      meta,
    });
  }
}
