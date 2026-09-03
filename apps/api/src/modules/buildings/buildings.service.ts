import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { Building } from './entities/building.entity';

@Injectable()
export class BuildingsService {
  constructor(@InjectRepository(Building) private readonly buildings: Repository<Building>) {}

  async create(dto: CreateBuildingDto): Promise<Building> {
    const [{ next_human_readable_number: code }] = await this.buildings.manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('BLD')");

    const building = this.buildings.create({
      code,
      nameAr: dto.name_ar,
      addressText: dto.address_text ?? null,
      cityId: dto.city_id ?? null,
      discountPercentage: dto.discount_percentage !== undefined ? String(dto.discount_percentage) : undefined,
      minimumMonthlyOrders: dto.minimum_monthly_orders,
    });
    return this.buildings.save(building);
  }

  list(): Promise<Building[]> {
    return this.buildings.find({ order: { createdAt: 'DESC' } });
  }

  async findByIdOrThrow(id: string): Promise<Building> {
    const building = await this.buildings.findOne({ where: { id } });
    if (!building) {
      throw new ApiException(ErrorCode.VAL_001, 'العمارة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return building;
  }

  /** بيتنادى من orders.service.ts وقت إنشاء طلب بكود عمارة — 404 واضح لو الكود غلط أو العمارة معطّلة. */
  async findActiveByCodeOrThrow(code: string): Promise<Building> {
    const building = await this.buildings.findOne({ where: { code, isActive: true } });
    if (!building) {
      throw new ApiException(ErrorCode.VAL_001, 'كود العمارة غير صحيح أو العمارة غير نشطة', HttpStatus.NOT_FOUND);
    }
    return building;
  }

  /**
   * نسخة **بلا throw** من `findActiveByCodeOrThrow` بالمعرّف بدل الكود — لمسارات غير تفاعلية
   * (توليد الطلبات المتكررة، docs/08 §122) لازم تتعامل مع عمارة اتقفلت/اتحذفت **بأمان**: تكمّل
   * الطلب من غير خصم بدل ما ترمي وتوقف التوليد أو تحسب خصم غلط. `findOne` من TypeORM بيستبعد
   * الصفوف الـsoft-deleted تلقائيًا (`@DeleteDateColumn`)، فمفيش حاجة تتفحص هنا غير `isActive`.
   */
  async findActiveByIdOrNull(id: string): Promise<Building | null> {
    const building = await this.buildings.findOne({ where: { id } });
    return building && building.isActive ? building : null;
  }

  async update(id: string, dto: UpdateBuildingDto): Promise<Building> {
    const building = await this.findByIdOrThrow(id);
    if (dto.name_ar !== undefined) building.nameAr = dto.name_ar;
    if (dto.address_text !== undefined) building.addressText = dto.address_text;
    if (dto.city_id !== undefined) building.cityId = dto.city_id;
    if (dto.discount_percentage !== undefined) building.discountPercentage = String(dto.discount_percentage);
    if (dto.minimum_monthly_orders !== undefined) building.minimumMonthlyOrders = dto.minimum_monthly_orders;
    if (dto.is_active !== undefined) building.isActive = dto.is_active;
    return this.buildings.save(building);
  }

  /** "الاشتراك الشهري" — تتبّع بس، مفيش إنفاذ تلقائي (docs/adr/0003-buildings-qr-discount.md). */
  async getCurrentMonthOrdersCount(buildingId: string): Promise<number> {
    // لازم deleted_at IS NULL — بدونها طلب soft-deleted كان لسه بيتحسب في عدّاد الاشتراك الشهري.
    const [{ count }] = await this.buildings.manager.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count FROM orders
       WHERE building_id = $1 AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AND deleted_at IS NULL`,
      [buildingId],
    );
    return Number(count);
  }

  /**
   * نسخة مجمّعة من getCurrentMonthOrdersCount لقائمة عمائر دفعة واحدة — استعلام واحد
   * (GROUP BY) بدل ما AdminBuildingsController.list() كان بينادي getCurrentMonthOrdersCount()
   * مرة منفصلة لكل عمارة (N+1 حقيقي، اتلقط في مراجعة الأداء الشاملة 2026-08-12).
   * العمائر اللي معندهاش طلبات الشهر ده مش بترجع في نتيجة GROUP BY — بنعوّضها بصفر هنا.
   */
  async getCurrentMonthOrdersCountBulk(buildingIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(buildingIds.map((id) => [id, 0]));
    if (buildingIds.length === 0) return counts;
    const rows = await this.buildings.manager.query<{ building_id: string; count: string }[]>(
      `SELECT building_id, COUNT(*)::int AS count FROM orders
       WHERE building_id = ANY($1) AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AND deleted_at IS NULL
       GROUP BY building_id`,
      [buildingIds],
    );
    for (const row of rows) counts.set(row.building_id, Number(row.count));
    return counts;
  }

  /** QR محلي بالكامل (مكتبة qrcode، بدون أي تكامل خارجي) — الكود نفسه نص عادي (building.code). */
  async generateQrPngDataUri(building: Building): Promise<string> {
    return QRCode.toDataURL(building.code, { errorCorrectionLevel: 'M', margin: 2, width: 400 });
  }
}
