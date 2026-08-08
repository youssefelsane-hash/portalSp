import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { GeoJsonPoint, GeoJsonPolygon } from '../../common/types/geo-json';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { CreateCityDto } from './dto/create-city.dto';
import { CreateServiceZoneDto } from './dto/create-service-zone.dto';
import { SetServiceZoneBoundaryDto } from './dto/set-service-zone-boundary.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { UpdateServiceZoneDto } from './dto/update-service-zone.dto';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { Country } from './entities/country.entity';
import { ServiceZone } from './entities/service-zone.entity';

function toPoint(latitude?: number, longitude?: number): GeoJsonPoint | undefined {
  if (latitude === undefined || longitude === undefined) return undefined;
  return { type: 'Point', coordinates: [longitude, latitude] };
}

// حلقة مضلّع GeoJSON لازم تكون مقفولة (أول نقطة == آخر نقطة) — لو الأدمن مبعتش النقطة الأخيرة
// مطابقة للأولى، بنقفلها تلقائياً بدل ما نرفض الطلب بتعقيد إضافي على العميل (لوحة رسم بسيطة
// عادةً مش بتضمن الإغلاق الصريح).
function toPolygon(dto: SetServiceZoneBoundaryDto): GeoJsonPolygon {
  const ring = dto.points.map((p): [number, number] => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push(first);
  }
  if (ring.length < 4) {
    throw new ApiException(
      ErrorCode.VAL_001,
      'المضلّع لازم يكون فيه 3 نقط مختلفة على الأقل',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { type: 'Polygon', coordinates: [ring] };
}

@Injectable()
export class AdminGeoService {
  constructor(
    @InjectRepository(City) private readonly cities: Repository<City>,
    @InjectRepository(Area) private readonly areas: Repository<Area>,
    @InjectRepository(ServiceZone) private readonly serviceZones: Repository<ServiceZone>,
    @InjectRepository(Country) private readonly countries: Repository<Country>,
    private readonly auditLog: AuditLogService,
  ) {}

  // ── الدول ────────────────────────────────────────────────────────────
  // قراءة بس — مفيش CRUD للدول لسه (كانت فجوة موثّقة: مفيش endpoint خالص، حتى قراءة، فمكانش
  // ممكن تعمل مدينة جديدة من apps/admin من غير ما تعرف country_id يدوياً من الـ DB مباشرة).
  // إنشاء/تعديل دولة جديدة لسه مش موجود عمداً — المنصة دولة واحدة (مصر) دلوقتي، إضافة دولة تانية
  // قرار عمل أكبر من مجرد صف DB (ISO code, عملة, بادئة هاتف... إلخ لازم تتراجع فعلياً).
  listCountries(): Promise<Country[]> {
    return this.countries.find({ order: { nameAr: 'ASC' } });
  }

  // ── المدن ────────────────────────────────────────────────────────────

  listCities(): Promise<City[]> {
    return this.cities.find({ order: { nameAr: 'ASC' } });
  }

  private async findCityOrThrow(id: string): Promise<City> {
    const city = await this.cities.findOne({ where: { id } });
    if (!city) {
      throw new ApiException(ErrorCode.VAL_001, 'المدينة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return city;
  }

  async createCity(adminUserId: string, dto: CreateCityDto, meta?: AuditActorMeta): Promise<City> {
    const existingSlug = await this.cities.findOne({ where: { slug: dto.slug } });
    if (existingSlug) {
      throw new ApiException(ErrorCode.VAL_001, 'الـ slug ده مستخدم لمدينة تانية بالفعل', HttpStatus.CONFLICT);
    }

    const city = this.cities.create({
      countryId: dto.country_id,
      nameAr: dto.name_ar,
      nameEn: dto.name_en,
      slug: dto.slug,
      timezone: dto.timezone ?? 'Africa/Cairo',
      centerLocation: toPoint(dto.latitude, dto.longitude) ?? null,
      isActive: true,
      launchedAt: new Date(),
    });
    await this.cities.save(city);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.city_created',
      entityType: 'city',
      entityId: city.id,
      newValues: { name_ar: city.nameAr, slug: city.slug },
      meta,
    });
    return city;
  }

  async updateCity(adminUserId: string, id: string, dto: UpdateCityDto, meta?: AuditActorMeta): Promise<City> {
    const city = await this.findCityOrThrow(id);
    if (dto.slug && dto.slug !== city.slug) {
      const existingSlug = await this.cities.findOne({ where: { slug: dto.slug } });
      if (existingSlug) {
        throw new ApiException(ErrorCode.VAL_001, 'الـ slug ده مستخدم لمدينة تانية بالفعل', HttpStatus.CONFLICT);
      }
    }

    const oldValues = { name_ar: city.nameAr, is_active: city.isActive };
    if (dto.country_id !== undefined) city.countryId = dto.country_id;
    if (dto.name_ar !== undefined) city.nameAr = dto.name_ar;
    if (dto.name_en !== undefined) city.nameEn = dto.name_en;
    if (dto.slug !== undefined) city.slug = dto.slug;
    if (dto.timezone !== undefined) city.timezone = dto.timezone;
    const point = toPoint(dto.latitude, dto.longitude);
    if (point) city.centerLocation = point;
    if (dto.is_active !== undefined) {
      city.isActive = dto.is_active;
      if (dto.is_active && !city.launchedAt) city.launchedAt = new Date();
    }
    await this.cities.save(city);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.city_updated',
      entityType: 'city',
      entityId: city.id,
      oldValues,
      newValues: { name_ar: city.nameAr, is_active: city.isActive },
      meta,
    });
    return city;
  }

  async deleteCity(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const city = await this.findCityOrThrow(id);
    const areasCount = await this.areas.count({ where: { cityId: id } });
    const zonesCount = await this.serviceZones.count({ where: { cityId: id } });
    if (areasCount > 0 || zonesCount > 0) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مينفعش تمسح مدينة فيها مناطق أو نطاقات خدمة — امسحهم الأول',
        HttpStatus.CONFLICT,
      );
    }
    await this.cities.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.city_deleted',
      entityType: 'city',
      entityId: city.id,
      oldValues: { name_ar: city.nameAr },
      meta,
    });
  }

  // ── المناطق ──────────────────────────────────────────────────────────

  listAreas(cityId?: string): Promise<Area[]> {
    return this.areas.find({ where: cityId ? { cityId } : {}, order: { nameAr: 'ASC' } });
  }

  private async findAreaOrThrow(id: string): Promise<Area> {
    const area = await this.areas.findOne({ where: { id } });
    if (!area) {
      throw new ApiException(ErrorCode.VAL_001, 'المنطقة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return area;
  }

  async createArea(adminUserId: string, dto: CreateAreaDto, meta?: AuditActorMeta): Promise<Area> {
    await this.findCityOrThrow(dto.city_id);

    const area = this.areas.create({
      cityId: dto.city_id,
      nameAr: dto.name_ar,
      nameEn: dto.name_en,
      slug: dto.slug,
      centerLocation: toPoint(dto.latitude, dto.longitude) ?? null,
      isActive: true,
      isLaunched: false,
    });
    await this.areas.save(area);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.area_created',
      entityType: 'area',
      entityId: area.id,
      newValues: { name_ar: area.nameAr, city_id: area.cityId },
      meta,
    });
    return area;
  }

  async updateArea(adminUserId: string, id: string, dto: UpdateAreaDto, meta?: AuditActorMeta): Promise<Area> {
    const area = await this.findAreaOrThrow(id);
    if (dto.city_id !== undefined) {
      await this.findCityOrThrow(dto.city_id);
      area.cityId = dto.city_id;
    }

    const oldValues = { name_ar: area.nameAr, is_active: area.isActive, is_launched: area.isLaunched };
    if (dto.name_ar !== undefined) area.nameAr = dto.name_ar;
    if (dto.name_en !== undefined) area.nameEn = dto.name_en;
    if (dto.slug !== undefined) area.slug = dto.slug;
    const point = toPoint(dto.latitude, dto.longitude);
    if (point) area.centerLocation = point;
    if (dto.is_active !== undefined) area.isActive = dto.is_active;
    if (dto.is_launched !== undefined) area.isLaunched = dto.is_launched;
    await this.areas.save(area);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.area_updated',
      entityType: 'area',
      entityId: area.id,
      oldValues,
      newValues: { name_ar: area.nameAr, is_active: area.isActive, is_launched: area.isLaunched },
      meta,
    });
    return area;
  }

  async deleteArea(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const area = await this.findAreaOrThrow(id);
    await this.areas.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.area_deleted',
      entityType: 'area',
      entityId: area.id,
      oldValues: { name_ar: area.nameAr },
      meta,
    });
  }

  // ── نطاقات الخدمة ────────────────────────────────────────────────────

  listServiceZones(cityId?: string): Promise<ServiceZone[]> {
    return this.serviceZones.find({ where: cityId ? { cityId } : {}, order: { nameAr: 'ASC' } });
  }

  private async findServiceZoneOrThrow(id: string): Promise<ServiceZone> {
    const zone = await this.serviceZones.findOne({ where: { id } });
    if (!zone) {
      throw new ApiException(ErrorCode.VAL_001, 'نطاق الخدمة غير موجود', HttpStatus.NOT_FOUND);
    }
    return zone;
  }

  async createServiceZone(adminUserId: string, dto: CreateServiceZoneDto, meta?: AuditActorMeta): Promise<ServiceZone> {
    await this.findCityOrThrow(dto.city_id);

    const zone = this.serviceZones.create({
      cityId: dto.city_id,
      nameAr: dto.name_ar,
      nameEn: dto.name_en,
      surgeMultiplier: dto.surge_multiplier !== undefined ? String(dto.surge_multiplier) : '1.00',
      minOrderAmountCents: dto.min_order_amount_cents ?? null,
      isActive: true,
    });
    await this.serviceZones.save(zone);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.service_zone_created',
      entityType: 'service_zone',
      entityId: zone.id,
      newValues: { name_ar: zone.nameAr, city_id: zone.cityId },
      meta,
    });
    return zone;
  }

  async updateServiceZone(adminUserId: string, id: string, dto: UpdateServiceZoneDto, meta?: AuditActorMeta): Promise<ServiceZone> {
    const zone = await this.findServiceZoneOrThrow(id);
    if (dto.city_id !== undefined) {
      await this.findCityOrThrow(dto.city_id);
      zone.cityId = dto.city_id;
    }

    const oldValues = { surge_multiplier: zone.surgeMultiplier, is_active: zone.isActive };
    if (dto.name_ar !== undefined) zone.nameAr = dto.name_ar;
    if (dto.name_en !== undefined) zone.nameEn = dto.name_en;
    if (dto.surge_multiplier !== undefined) zone.surgeMultiplier = String(dto.surge_multiplier);
    if (dto.min_order_amount_cents !== undefined) zone.minOrderAmountCents = dto.min_order_amount_cents;
    if (dto.is_active !== undefined) zone.isActive = dto.is_active;
    await this.serviceZones.save(zone);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.service_zone_updated',
      entityType: 'service_zone',
      entityId: zone.id,
      oldValues,
      newValues: { surge_multiplier: zone.surgeMultiplier, is_active: zone.isActive },
      meta,
    });
    return zone;
  }

  // بيرجّع النقط الخام (`{lng, lat}`) مش الـ GeoJSON الخام، عشان أي لوحة رسم في apps/admin
  // تقدر تحمّل المضلّع الحالي وتعرضه للتعديل من غير ما تفكّ شكل GeoJSON بنفسها.
  async getServiceZoneBoundary(id: string): Promise<{ lng: number; lat: number }[] | null> {
    const zone = await this.findServiceZoneOrThrow(id);
    if (!zone.boundary) return null;
    return zone.boundary.coordinates[0].map(([lng, lat]) => ({ lng, lat }));
  }

  async setServiceZoneBoundary(
    adminUserId: string,
    id: string,
    dto: SetServiceZoneBoundaryDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceZone> {
    const zone = await this.findServiceZoneOrThrow(id);
    const hadBoundaryBefore = zone.boundary !== null;
    zone.boundary = toPolygon(dto);
    await this.serviceZones.save(zone);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: hadBoundaryBefore ? 'geo.service_zone_boundary_updated' : 'geo.service_zone_boundary_set',
      entityType: 'service_zone',
      entityId: zone.id,
      newValues: { points_count: dto.points.length },
      meta,
    });
    return zone;
  }

  async deleteServiceZone(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const zone = await this.findServiceZoneOrThrow(id);
    await this.serviceZones.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'geo.service_zone_deleted',
      entityType: 'service_zone',
      entityId: zone.id,
      oldValues: { name_ar: zone.nameAr },
      meta,
    });
  }
}
