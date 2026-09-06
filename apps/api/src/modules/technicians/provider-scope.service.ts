import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { Service } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TechnicianCategory } from '../catalog/entities/technician-category.entity';
import { TechnicianService, TechnicianServiceVerificationStatus } from '../catalog/entities/technician-service.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianZone } from './entities/technician-zone.entity';

/**
 * **نطاق المنفّذ — التنفيذ الواحد لتعيين/سحب الخدمات والفئات والمناطق** (ADR-0079).
 *
 * الخدمة دي بتشتغل على **نفس الجداول التلاتة** بعمود مالك متغيّر: فني فرد أو شركة. مفيش نسخة
 * تانية من المنطق ولا من الجداول — «دخّلها على نفس اللاين» (طلب مالك، 2026-09-06).
 *
 * **حدود المرحلة ١ بصراحة**: مسارات الأدمن القايمة للفني (`AdminTechniciansService.assignZone`،
 * `TechnicianCategoriesService.adminAssignCategory`) لسه بتكتب بنفسها. تحويلها لتنادي الخدمة
 * دي هو الخطوة الجاية المسجّلة في ADR-0079 — اتأجّلت عمدًا لأنها بتلمس ٢٦+ ملف اختبار بتبني
 * الخدمات دي بـ`new` مباشرة، وخلطها مع تغيير المخطط في نفس الدفعة بيخلي أي رجعة صعبة العزل.
 */
export type ProviderOwner = { kind: 'technician'; id: string } | { kind: 'company'; id: string };

@Injectable()
export class ProviderScopeService {
  constructor(
    @InjectRepository(TechnicianService) private readonly providerServices: Repository<TechnicianService>,
    @InjectRepository(TechnicianCategory) private readonly providerCategories: Repository<TechnicianCategory>,
    @InjectRepository(TechnicianZone) private readonly providerZones: Repository<TechnicianZone>,
    @InjectRepository(TechnicianCompany) private readonly companies: Repository<TechnicianCompany>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceCategory) private readonly serviceCategories: Repository<ServiceCategory>,
    @InjectRepository(ServiceZone) private readonly serviceZones: Repository<ServiceZone>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * شرط الملكية بشكل TypeORM — الوجه التاني لنفس القيد اللي القاعدة بتفرضه (`chk_*_owner`).
   * `IsNull()` على العمود التاني **مش تزيّن**: من غيرها صف الشركة وصف الفني على نفس الخدمة
   * ممكن يتلخبطوا في القراءة.
   */
  private ownerWhere(owner: ProviderOwner) {
    return owner.kind === 'technician'
      ? { technicianId: owner.id, companyId: IsNull() }
      : { technicianId: IsNull(), companyId: owner.id };
  }

  /** نفس الملكية كقيم للكتابة (`create`) — `null` مش `IsNull()`. */
  private ownerColumns(owner: ProviderOwner): { technicianId: string | null; companyId: string | null } {
    return owner.kind === 'technician'
      ? { technicianId: owner.id, companyId: null }
      : { technicianId: null, companyId: owner.id };
  }

  private async assertCompanyExists(companyId: string): Promise<TechnicianCompany> {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company || !company.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الشركة غير موجودة أو متوقفة', HttpStatus.NOT_FOUND);
    }
    return company;
  }

  // ── خدمات ────────────────────────────────────────────────────────────
  listServices(owner: ProviderOwner): Promise<TechnicianService[]> {
    return this.providerServices.find({ where: this.ownerWhere(owner), order: { createdAt: 'DESC' } });
  }

  async assignService(
    adminUserId: string,
    owner: ProviderOwner,
    serviceId: string,
    meta?: AuditActorMeta,
  ): Promise<TechnicianService> {
    if (owner.kind === 'company') await this.assertCompanyExists(owner.id);
    const service = await this.services.findOne({ where: { id: serviceId } });
    if (!service || !service.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة أو متوقفة', HttpStatus.NOT_FOUND);
    }

    const where = this.ownerWhere(owner);
    const existing = await this.providerServices.findOne({
      where: { ...where, serviceId },
    });
    if (existing && existing.isActive && existing.verificationStatus === TechnicianServiceVerificationStatus.APPROVED) {
      return existing; // idempotent — صفر تكرار في سجل التدقيق
    }

    const row = existing ?? this.providerServices.create({ ...this.ownerColumns(owner), serviceId, isSelfDeclared: false });
    row.verificationStatus = TechnicianServiceVerificationStatus.APPROVED;
    row.isActive = true;
    row.rejectionReason = null;
    row.reviewedByUserId = adminUserId;
    row.reviewedAt = new Date();
    await this.providerServices.save(row);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `provider_service.admin_assigned`,
      entityType: owner.kind === 'company' ? 'technician_company' : 'technician_profile',
      entityId: owner.id,
      newValues: { service_id: serviceId, owner_kind: owner.kind },
      meta,
    });
    return row;
  }

  async removeService(adminUserId: string, owner: ProviderOwner, serviceId: string, meta?: AuditActorMeta): Promise<void> {
    const where = this.ownerWhere(owner);
    const existing = await this.providerServices.findOne({
      where: { ...where, serviceId },
    });
    if (!existing || !existing.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مش معيّنة للمنفّذ ده أصلاً', HttpStatus.NOT_FOUND);
    }
    existing.isActive = false;
    await this.providerServices.save(existing);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `provider_service.admin_removed`,
      entityType: owner.kind === 'company' ? 'technician_company' : 'technician_profile',
      entityId: owner.id,
      oldValues: { is_active: true },
      newValues: { is_active: false, service_id: serviceId, owner_kind: owner.kind },
      meta,
    });
  }

  // ── فئات ─────────────────────────────────────────────────────────────
  listCategories(owner: ProviderOwner): Promise<TechnicianCategory[]> {
    return this.providerCategories.find({ where: this.ownerWhere(owner), order: { createdAt: 'DESC' } });
  }

  async assignCategory(
    adminUserId: string,
    owner: ProviderOwner,
    categoryId: string,
    meta?: AuditActorMeta,
  ): Promise<TechnicianCategory> {
    if (owner.kind === 'company') await this.assertCompanyExists(owner.id);
    const category = await this.serviceCategories.findOne({ where: { id: categoryId } });
    if (!category || !category.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الفئة غير موجودة أو متوقفة', HttpStatus.NOT_FOUND);
    }

    const where = this.ownerWhere(owner);
    const existing = await this.providerCategories.findOne({
      where: { ...where, categoryId },
    });
    if (existing && existing.isActive && existing.verificationStatus === TechnicianServiceVerificationStatus.APPROVED) {
      return existing;
    }

    const row = existing ?? this.providerCategories.create({ ...this.ownerColumns(owner), categoryId, isSelfDeclared: false });
    row.verificationStatus = TechnicianServiceVerificationStatus.APPROVED;
    row.isActive = true;
    row.rejectionReason = null;
    row.reviewedByUserId = adminUserId;
    row.reviewedAt = new Date();
    await this.providerCategories.save(row);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `provider_category.admin_assigned`,
      entityType: owner.kind === 'company' ? 'technician_company' : 'technician_profile',
      entityId: owner.id,
      newValues: { category_id: categoryId, owner_kind: owner.kind },
      meta,
    });
    return row;
  }

  async removeCategory(adminUserId: string, owner: ProviderOwner, categoryId: string, meta?: AuditActorMeta): Promise<void> {
    const where = this.ownerWhere(owner);
    const existing = await this.providerCategories.findOne({
      where: { ...where, categoryId },
    });
    if (!existing || !existing.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الفئة دي مش معيّنة للمنفّذ ده أصلاً', HttpStatus.NOT_FOUND);
    }
    existing.isActive = false;
    await this.providerCategories.save(existing);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `provider_category.admin_removed`,
      entityType: owner.kind === 'company' ? 'technician_company' : 'technician_profile',
      entityId: owner.id,
      oldValues: { is_active: true },
      newValues: { is_active: false, category_id: categoryId, owner_kind: owner.kind },
      meta,
    });
  }

  // ── مناطق ────────────────────────────────────────────────────────────
  listZones(owner: ProviderOwner): Promise<TechnicianZone[]> {
    return this.providerZones.find({ where: this.ownerWhere(owner), order: { createdAt: 'DESC' } });
  }

  async assignZone(
    adminUserId: string,
    owner: ProviderOwner,
    serviceZoneId: string,
    isPrimary: boolean,
    meta?: AuditActorMeta,
  ): Promise<TechnicianZone> {
    if (owner.kind === 'company') await this.assertCompanyExists(owner.id);
    const zone = await this.serviceZones.findOne({ where: { id: serviceZoneId } });
    if (!zone) {
      throw new ApiException(ErrorCode.VAL_001, 'المنطقة غير موجودة', HttpStatus.NOT_FOUND);
    }

    const where = this.ownerWhere(owner);
    const existing = await this.providerZones.findOne({
      where: { ...where, serviceZoneId },
    });
    if (existing) {
      if (existing.isActive) {
        throw new ApiException(ErrorCode.VAL_001, 'المنطقة دي متعيّنة للمنفّذ ده بالفعل', HttpStatus.CONFLICT);
      }
      existing.isActive = true;
      existing.isPrimary = isPrimary;
      await this.providerZones.save(existing);
      return existing;
    }

    const row = this.providerZones.create({ ...this.ownerColumns(owner), serviceZoneId, isPrimary });
    await this.providerZones.save(row);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `provider_zone.assigned`,
      entityType: owner.kind === 'company' ? 'technician_company' : 'technician_profile',
      entityId: owner.id,
      newValues: { service_zone_id: serviceZoneId, is_primary: isPrimary, owner_kind: owner.kind },
      meta,
    });
    return row;
  }

  async removeZone(adminUserId: string, owner: ProviderOwner, serviceZoneId: string, meta?: AuditActorMeta): Promise<void> {
    const where = this.ownerWhere(owner);
    const existing = await this.providerZones.findOne({
      where: { ...where, serviceZoneId },
    });
    if (!existing || !existing.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'المنطقة دي مش معيّنة للمنفّذ ده أصلاً', HttpStatus.NOT_FOUND);
    }
    existing.isActive = false;
    await this.providerZones.save(existing);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `provider_zone.removed`,
      entityType: owner.kind === 'company' ? 'technician_company' : 'technician_profile',
      entityId: owner.id,
      oldValues: { is_active: true },
      newValues: { is_active: false, service_zone_id: serviceZoneId, owner_kind: owner.kind },
      meta,
    });
  }
}
