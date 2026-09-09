import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import {
  SetZoneCatalogAvailabilityDto,
  ZoneCatalogTargetType,
} from './dto/set-zone-catalog-availability.dto';

export interface ZoneCatalogServiceRow {
  id: string;
  name_ar: string;
  is_active: boolean;
  effective_enabled: boolean;
  override_enabled: boolean | null;
}

export interface ZoneCatalogCategoryRow {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  is_active: boolean;
  effective_enabled: boolean;
  override_enabled: boolean | null;
  services: ZoneCatalogServiceRow[];
}

@Injectable()
export class ZoneCatalogAvailabilityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  async listForZone(zoneId: string): Promise<ZoneCatalogCategoryRow[]> {
    await this.assertZoneExists(this.dataSource.manager, zoneId);
    const [categories, services] = await Promise.all([
      this.dataSource.query<
        Omit<ZoneCatalogCategoryRow, 'services'>[]
      >(
        `SELECT category.id,
                category.parent_category_id,
                category.name_ar,
                category.is_active,
                catalog_category_enabled_in_zone(category.id, $1) AS effective_enabled,
                override.is_enabled AS override_enabled
           FROM service_categories category
           LEFT JOIN service_zone_catalog_overrides override
             ON override.service_zone_id = $1 AND override.category_id = category.id
          WHERE category.deleted_at IS NULL
          ORDER BY category.display_order ASC, category.name_ar ASC`,
        [zoneId],
      ),
      this.dataSource.query<
        (ZoneCatalogServiceRow & { category_id: string })[]
      >(
        `SELECT service.id,
                service.category_id,
                service.name_ar,
                service.is_active,
                catalog_service_enabled_in_zone(service.id, $1) AS effective_enabled,
                override.is_enabled AS override_enabled
           FROM services service
           LEFT JOIN service_zone_catalog_overrides override
             ON override.service_zone_id = $1 AND override.service_id = service.id
          WHERE service.deleted_at IS NULL
          ORDER BY service.display_order ASC, service.name_ar ASC`,
        [zoneId],
      ),
    ]);

    const byCategory = new Map<string, ZoneCatalogServiceRow[]>();
    for (const service of services) {
      const rows = byCategory.get(service.category_id) ?? [];
      rows.push({
        id: service.id,
        name_ar: service.name_ar,
        is_active: service.is_active,
        effective_enabled: service.effective_enabled,
        override_enabled: service.override_enabled,
      });
      byCategory.set(service.category_id, rows);
    }
    return categories.map((category) => ({
      ...category,
      services: byCategory.get(category.id) ?? [],
    }));
  }

  async setOverride(
    adminUserId: string,
    zoneId: string,
    dto: SetZoneCatalogAvailabilityDto,
    meta?: AuditActorMeta,
  ): Promise<ZoneCatalogCategoryRow[]> {
    await this.dataSource.transaction(async (manager) => {
      // Lock the whole zone rather than one target. A category rule changes every descendant
      // service, so two apparently different targets can affect the same effective result.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `zone-catalog:${zoneId}`,
      ]);
      await this.assertZoneExists(manager, zoneId);
      await this.assertTargetExists(manager, dto.target_type, dto.target_id);

      const targetColumn =
        dto.target_type === ZoneCatalogTargetType.CATEGORY ? 'category_id' : 'service_id';
      const [oldRow] = await manager.query<{ is_enabled: boolean }[]>(
        `SELECT is_enabled FROM service_zone_catalog_overrides
          WHERE service_zone_id = $1 AND ${targetColumn} = $2`,
        [zoneId, dto.target_id],
      );

      if (dto.is_enabled == null) {
        await manager.query(
          `DELETE FROM service_zone_catalog_overrides
            WHERE service_zone_id = $1 AND ${targetColumn} = $2`,
          [zoneId, dto.target_id],
        );
      } else {
        await manager.query(
          `INSERT INTO service_zone_catalog_overrides
             (service_zone_id, ${targetColumn}, is_enabled, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (service_zone_id, ${targetColumn}) WHERE ${targetColumn} IS NOT NULL
           DO UPDATE SET is_enabled = EXCLUDED.is_enabled,
                         created_by = EXCLUDED.created_by,
                         updated_at = now()`,
          [zoneId, dto.target_id, dto.is_enabled, adminUserId],
        );
      }

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'geo.zone_catalog_availability_updated',
          entityType: 'service_zone',
          entityId: zoneId,
          oldValues: {
            target_type: dto.target_type,
            target_id: dto.target_id,
            is_enabled: oldRow?.is_enabled ?? null,
          },
          newValues: {
            target_type: dto.target_type,
            target_id: dto.target_id,
            is_enabled: dto.is_enabled,
          },
          meta,
        },
        manager,
      );
    });
    return this.listForZone(zoneId);
  }

  private async assertZoneExists(manager: EntityManager, zoneId: string): Promise<void> {
    const [{ exists }] = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS(
         SELECT 1 FROM service_zones
          WHERE id = $1 AND deleted_at IS NULL
       ) AS exists`,
      [zoneId],
    );
    if (!exists) {
      throw new ApiException(ErrorCode.VAL_001, 'نطاق الخدمة غير موجود', HttpStatus.NOT_FOUND);
    }
  }

  private async assertTargetExists(
    manager: EntityManager,
    targetType: ZoneCatalogTargetType,
    targetId: string,
  ): Promise<void> {
    const table =
      targetType === ZoneCatalogTargetType.CATEGORY ? 'service_categories' : 'services';
    const [{ exists }] = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL) AS exists`,
      [targetId],
    );
    if (!exists) {
      throw new ApiException(
        ErrorCode.VAL_001,
        targetType === ZoneCatalogTargetType.CATEGORY ? 'الفئة غير موجودة' : 'الخدمة غير موجودة',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
