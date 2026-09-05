import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MAX_BRANDING_FILE_SIZE_BYTES } from '../branding/branding-file-validator';
import { CategoryMediaSlotParamDto } from './dto/category-media-slot-param.dto';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminCatalogService } from './admin-catalog.service';
import { ProductivityLearningService } from './productivity-learning.service';
import { ProductivitySuggestionStatus } from './entities/service-productivity-suggestion.entity';
import {
  toAdminServiceCategoryResponseDto,
  toAdminServiceResponseDto,
  toEligibleTechnicianResponseDto,
  toServiceAddonResponseDto,
  toServiceLevelPricingResponseDto,
  toServicePricingTierPricingResponseDto,
  toServiceProductivityActualResponseDto,
  toServiceProductivitySuggestionResponseDto,
  toServiceStandardDataResponseDto,
  toServiceZonePricingResponseDto,
} from './dto/admin-catalog-response.dto';
import { AssignTechnicianServiceDto } from './dto/assign-technician-service.dto';
import { CreateServiceAddonDto } from './dto/create-service-addon.dto';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreateServiceStandardDataDto } from './dto/create-service-standard-data.dto';
import { RecordProductivityActualDto } from './dto/record-productivity-actual.dto';
import { UpdateServiceAddonDto } from './dto/update-service-addon.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStandardDataDto } from './dto/update-service-standard-data.dto';
import { UpsertLevelPricingDto } from './dto/upsert-level-pricing.dto';
import { UpsertPricingTierPricingDto } from './dto/upsert-pricing-tier-pricing.dto';
import { UpsertZonePricingDto } from './dto/upsert-zone-pricing.dto';

@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminCatalogController {
  constructor(
    private readonly adminCatalogService: AdminCatalogService,
    private readonly productivityLearningService: ProductivityLearningService,
  ) {}

  // ── الفئات ───────────────────────────────────────────────────────────

  @Get('service-categories')
  @RequirePermission('catalog.view')
  async listCategories() {
    const categories = await this.adminCatalogService.listAllCategories();
    return categories.map(toAdminServiceCategoryResponseDto);
  }

  @Post('service-categories')
  @RequirePermission('catalog.manage')
  async createCategory(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateServiceCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceCategoryResponseDto(await this.adminCatalogService.createCategory(admin.sub, dto, audit));
  }

  @Patch('service-categories/:id')
  @RequirePermission('catalog.manage')
  async updateCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceCategoryResponseDto(await this.adminCatalogService.updateCategory(admin.sub, id, dto, audit));
  }

  /**
   * رفع/استبدال صورة فئة (docs/08 §98، بلاغ مالك) — الفجوة الحقيقية اللي كانت بتخلّي الصورة
   * "تتحط مرة واحدة بس": الحقول كانت روابط نصية ومفيش أي مكان في المنصة يرفع صورة فئة أصلاً.
   * نفس فحوصات ملف البراندنج بالحرف (MIME + magic bytes + حجم + أبعاد، مفيش SVG).
   */
  @Post('service-categories/:id/media/:slot')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_BRANDING_FILE_SIZE_BYTES } }))
  async uploadCategoryMedia(
    @CurrentUser() admin: JwtPayload,
    @Param() params: CategoryMediaSlotParamDto,
    @UploadedFile() file: Express.Multer.File,
    @AuditContext() audit: AuditMeta,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    return toAdminServiceCategoryResponseDto(
      await this.adminCatalogService.uploadCategoryMedia(admin.sub, params.id, params.slot, file, audit),
    );
  }

  /** مسح صورة فئة (docs/08 §98) — كانت مستحيلة عبر PATCH (خانة فاضية = مفتاح محذوف من الـJSON). */
  @Delete('service-categories/:id/media/:slot')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async clearCategoryMedia(
    @CurrentUser() admin: JwtPayload,
    @Param() params: CategoryMediaSlotParamDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceCategoryResponseDto(
      await this.adminCatalogService.clearCategoryMedia(admin.sub, params.id, params.slot, audit),
    );
  }

  @Delete('service-categories/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteCategory(admin.sub, id, audit);
    return { id, deleted: true };
  }

  // ── الخدمات ──────────────────────────────────────────────────────────

  @Get('services')
  @RequirePermission('catalog.view')
  async listServices(@Query('category_id') categoryId?: string) {
    const services = await this.adminCatalogService.listAllServices(categoryId);
    return services.map(toAdminServiceResponseDto);
  }

  @Post('services')
  @RequirePermission('catalog.manage')
  async createService(@CurrentUser() admin: JwtPayload, @Body() dto: CreateServiceDto, @AuditContext() audit: AuditMeta) {
    return toAdminServiceResponseDto(await this.adminCatalogService.createService(admin.sub, dto, audit));
  }

  @Patch('services/:id')
  @RequirePermission('catalog.manage')
  async updateService(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceResponseDto(await this.adminCatalogService.updateService(admin.sub, id, dto, audit));
  }

  @Delete('services/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteService(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteService(admin.sub, id, audit);
    return { id, deleted: true };
  }

  // ── تسعير حسب المنطقة ───────────────────────────────────────────────

  @Get('services/:id/zone-pricing')
  @RequirePermission('catalog.view')
  async listZonePricing(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listZonePricing(id);
    return rows.map(toServiceZonePricingResponseDto);
  }

  @Put('services/:id/zone-pricing')
  @RequirePermission('catalog.manage')
  async upsertZonePricing(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertZonePricingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceZonePricingResponseDto(await this.adminCatalogService.upsertZonePricing(admin.sub, id, dto, audit));
  }

  @Delete('services/zone-pricing/:pricingId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deactivateZonePricing(
    @CurrentUser() admin: JwtPayload,
    @Param('pricingId', ParseUUIDPipe) pricingId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deactivateZonePricing(admin.sub, pricingId, audit);
    return { id: pricingId, deactivated: true };
  }

  // ── الفنيين المؤهلين ─────────────────────────────────────────────────

  @Get('services/:id/technicians')
  @RequirePermission('catalog.view')
  async listEligibleTechnicians(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listEligibleTechnicians(id);
    return rows.map(toEligibleTechnicianResponseDto);
  }

  @Post('services/:id/technicians')
  @RequirePermission('catalog.manage')
  async assignTechnician(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTechnicianServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toEligibleTechnicianResponseDto(await this.adminCatalogService.assignTechnician(admin.sub, id, dto, audit));
  }

  @Delete('services/:id/technicians/:technicianId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async removeTechnician(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('technicianId', ParseUUIDPipe) technicianId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.removeTechnician(admin.sub, id, technicianId, audit);
    return { technician_id: technicianId, removed: true };
  }

  // ── تسعير حسب مستوى الفني ────────────────────────────────────────────

  @Get('services/:id/level-pricing')
  @RequirePermission('catalog.view')
  async listLevelPricing(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listLevelPricing(id);
    return rows.map(toServiceLevelPricingResponseDto);
  }

  @Put('services/:id/level-pricing')
  @RequirePermission('catalog.manage')
  async upsertLevelPricing(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertLevelPricingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceLevelPricingResponseDto(await this.adminCatalogService.upsertLevelPricing(admin.sub, id, dto, audit));
  }

  @Delete('services/level-pricing/:pricingId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deactivateLevelPricing(
    @CurrentUser() admin: JwtPayload,
    @Param('pricingId', ParseUUIDPipe) pricingId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deactivateLevelPricing(admin.sub, pricingId, audit);
    return { id: pricingId, deactivated: true };
  }

  // ── فئة تسعير الفني (docs/08 §36.24، ADR-0025) — منفصلة عن تسعير المستوى فوق ───────────

  @Get('services/:id/pricing-tier-pricing')
  @RequirePermission('catalog.view')
  async listPricingTierPricing(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listPricingTierPricing(id);
    return rows.map(toServicePricingTierPricingResponseDto);
  }

  @Put('services/:id/pricing-tier-pricing')
  @RequirePermission('catalog.manage')
  async upsertPricingTierPricing(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPricingTierPricingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServicePricingTierPricingResponseDto(await this.adminCatalogService.upsertPricingTierPricing(admin.sub, id, dto, audit));
  }

  @Delete('services/pricing-tier-pricing/:pricingId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deactivatePricingTierPricing(
    @CurrentUser() admin: JwtPayload,
    @Param('pricingId', ParseUUIDPipe) pricingId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deactivatePricingTierPricing(admin.sub, pricingId, audit);
    return { id: pricingId, deactivated: true };
  }

  // ── الإضافات الاختيارية ──────────────────────────────────────────────

  @Get('services/:id/addons')
  @RequirePermission('catalog.view')
  async listAddons(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listAddons(id);
    return rows.map(toServiceAddonResponseDto);
  }

  @Post('services/:id/addons')
  @RequirePermission('catalog.manage')
  async createAddon(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceAddonDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceAddonResponseDto(await this.adminCatalogService.createAddon(admin.sub, id, dto, audit));
  }

  @Patch('services/addons/:addonId')
  @RequirePermission('catalog.manage')
  async updateAddon(
    @CurrentUser() admin: JwtPayload,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @Body() dto: UpdateServiceAddonDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceAddonResponseDto(await this.adminCatalogService.updateAddon(admin.sub, addonId, dto, audit));
  }

  @Delete('services/addons/:addonId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteAddon(
    @CurrentUser() admin: JwtPayload,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteAddon(admin.sub, addonId, audit);
    return { id: addonId, deleted: true };
  }

  // ── البيانات القياسية ومحرك الإنتاجية (docs/06 §3.1-§3.6) ────────────────

  @Get('services/:id/standard-data')
  @RequirePermission('catalog.view')
  async listStandardData(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listStandardData(id);
    return rows.map(toServiceStandardDataResponseDto);
  }

  @Post('services/:id/standard-data')
  @RequirePermission('catalog.manage')
  async createStandardData(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceStandardDataDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceStandardDataResponseDto(
      await this.adminCatalogService.createStandardData(admin.sub, id, dto, audit),
    );
  }

  @Patch('services/standard-data/:standardDataId')
  @RequirePermission('catalog.manage')
  async updateStandardData(
    @CurrentUser() admin: JwtPayload,
    @Param('standardDataId', ParseUUIDPipe) standardDataId: string,
    @Body() dto: UpdateServiceStandardDataDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceStandardDataResponseDto(
      await this.adminCatalogService.updateStandardData(admin.sub, standardDataId, dto, audit),
    );
  }

  @Delete('services/standard-data/:standardDataId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteStandardData(
    @CurrentUser() admin: JwtPayload,
    @Param('standardDataId', ParseUUIDPipe) standardDataId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteStandardData(admin.sub, standardDataId, audit);
    return { id: standardDataId, deleted: true };
  }

  // ── أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9) — مرحلة 1: تسجيل بس ────────

  @Get('services/standard-data/:standardDataId/actuals')
  @RequirePermission('catalog.view')
  async listProductivityActuals(@Param('standardDataId', ParseUUIDPipe) standardDataId: string) {
    const rows = await this.adminCatalogService.listProductivityActuals(standardDataId);
    return rows.map(toServiceProductivityActualResponseDto);
  }

  @Post('services/standard-data/:standardDataId/actuals')
  @RequirePermission('catalog.manage')
  async recordProductivityActual(
    @CurrentUser() admin: JwtPayload,
    @Param('standardDataId', ParseUUIDPipe) standardDataId: string,
    @Body() dto: RecordProductivityActualDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceProductivityActualResponseDto(
      await this.adminCatalogService.recordProductivityActual(admin.sub, standardDataId, dto, audit),
    );
  }

  // ── مرحلة 2 من محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) ─────
  // observation → aggregate (median) → اقتراح → موافقة/رفض الأدمن. تفاصيل الـpipeline الكاملة
  // في productivity-learning.service.ts.

  @Get('services/productivity-suggestions')
  @RequirePermission('catalog.view')
  async listProductivitySuggestions(@Query('status') status?: ProductivitySuggestionStatus) {
    const rows = await this.productivityLearningService.listSuggestions(status);
    return rows.map(toServiceProductivitySuggestionResponseDto);
  }

  // فحص التجميع الدوري (كل ساعة، onModuleInit) بيتحكّم فيه setInterval — الزرار ده بيخلي
  // الأدمن/العمليات يقدروا يجبروا فحص فوري بدل الاستنى (نفس فلسفة "إعادة فحص فورية" في أي job
  // دوري تاني بالمشروع)، مفيش منطق تجميع مكرر — نفس الدالة بالحرف.
  @Post('services/productivity-suggestions/generate')
  @RequirePermission('catalog.manage')
  async generateProductivitySuggestionsNow() {
    const created = await this.productivityLearningService.generateSuggestions();
    return { created };
  }

  @Post('services/productivity-suggestions/:id/approve')
  @RequirePermission('catalog.manage')
  async approveProductivitySuggestion(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceProductivitySuggestionResponseDto(
      await this.productivityLearningService.approveSuggestion(admin.sub, id, audit),
    );
  }

  @Post('services/productivity-suggestions/:id/reject')
  @RequirePermission('catalog.manage')
  async rejectProductivitySuggestion(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceProductivitySuggestionResponseDto(
      await this.productivityLearningService.rejectSuggestion(admin.sub, id, audit),
    );
  }
}
