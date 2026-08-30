import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';

/** خدمة واحدة جوّه فئة معتمدة للفني، ومعاها حالتها عنده. */
export interface TechnicianServicePermissionRow {
  service_id: string;
  service_name_ar: string;
  category_id: string;
  category_name_ar: string;
  is_excluded: boolean;
  exclusion_reason: string | null;
  excluded_at: string | null;
}

/**
 * حجب خدمات بعينها عن فني بعينه (ADR-0049، docs/08 §86).
 *
 * **قائمة حجب مش قائمة سماح**: الفني المعتمد في فئة شغّال على **كل** خدماتها افتراضيًا، والأدمن
 * بيحجب اللي يختاره. الفرض الفعلي للحجب مش هنا — هو في
 * `technicianServiceQualificationCondition()` (`technician-eligibility.sql.ts`)، اللي كل مسارات
 * التوزيع والاختيار التسعة بتناديها. الخدمة دي بتدير البيانات وبتعرضها للأدمن بس.
 */
@Injectable()
export class TechnicianServiceExclusionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * كل الخدمات اللي **جوّه فئات الفني المعتمدة** (اللي هو أصلاً بيشتغل عليها)، ومعاها علامة
   * محجوب/مسموح.
   *
   * **مبنية على الفئات المعتمدة بس عمدًا**: الأدمن بيحجب من اللي الفني شايفه فعلاً — عرض كتالوج
   * الخدمات كله كان هيخلّي الشاشة قايمة بمئات البنود أغلبها مالهاش أي علاقة بالفني ده. ده بالحرف
   * اللي المالك وصفه: «يطلع له الشغلانات الداخلية كلها جوه الحاجات اللي هو مقبول فيها».
   *
   * `technician_services` المباشرة داخلة كمان (`UNION`): الفني ممكن يكون معتمد في خدمة بعينها
   * برّه فئاته، ولازم الأدمن يقدر يحجبها زي أي حاجة تانية.
   *
   * مفيش استثناء للمساعد هنا: هو بيقدّم على تخصص وبيتعتمد فيه بنفس دورة الفني، وبالتالي شاشة
   * الأدمن لازم تعرض له خدمات الاعتمادات الحقيقية فقط. عرض كل الكتالوج كان يوحي بأهلية غير
   * موجودة ويكسر الجدار المطلوب بين السباكة والكهرباء وباقي التخصصات.
   */
  async listForTechnician(technicianId: string): Promise<TechnicianServicePermissionRow[]> {
    return this.dataSource.query<TechnicianServicePermissionRow[]>(
      `
      WITH qualified AS (
        SELECT s.id AS service_id, s.name_ar AS service_name_ar, sc.id AS category_id, sc.name_ar AS category_name_ar
        FROM technician_categories tc
        JOIN service_categories sc ON sc.id = tc.category_id
        JOIN services s ON s.category_id = sc.id AND s.deleted_at IS NULL AND s.is_active = true
        WHERE tc.technician_id = $1 AND tc.is_active = true AND tc.verification_status = 'approved'
        UNION
        SELECT s.id, s.name_ar, sc.id, sc.name_ar
        FROM technician_services ts
        JOIN services s ON s.id = ts.service_id AND s.deleted_at IS NULL AND s.is_active = true
        JOIN service_categories sc ON sc.id = s.category_id
        WHERE ts.technician_id = $1 AND ts.is_active = true AND ts.verification_status = 'approved'
      )
      SELECT q.service_id, q.service_name_ar, q.category_id, q.category_name_ar,
             (tes.id IS NOT NULL) AS is_excluded,
             tes.reason AS exclusion_reason,
             tes.created_at::text AS excluded_at
      FROM qualified q
      LEFT JOIN technician_excluded_services tes
        ON tes.technician_id = $1 AND tes.service_id = q.service_id
      ORDER BY q.category_name_ar, q.service_name_ar
      `,
      [technicianId],
    );
  }

  /** حجب خدمة. Idempotent — حجب مرتين بيحدّث السبب بدل ما يرمي. */
  async exclude(
    adminUserId: string,
    technicianId: string,
    serviceId: string,
    reason: string | null,
    meta?: AuditActorMeta,
  ): Promise<TechnicianServicePermissionRow[]> {
    // الفني والخدمة لازم يكونوا موجودين فعلاً — الـFK هيمسكها، بس رسالة واضحة أحسن من 500.
    const [technician] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM technician_profiles WHERE id = $1 AND deleted_at IS NULL`,
      [technicianId],
    );
    if (!technician) throw new ApiException(ErrorCode.VAL_001, 'الفني ده مش موجود', HttpStatus.NOT_FOUND);
    const [service] = await this.dataSource.query<{ id: string; name_ar: string }[]>(
      `SELECT id, name_ar FROM services WHERE id = $1 AND deleted_at IS NULL`,
      [serviceId],
    );
    if (!service) throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي مش موجودة', HttpStatus.NOT_FOUND);

    await this.dataSource.query(
      `INSERT INTO technician_excluded_services (technician_id, service_id, reason, excluded_by_user_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (technician_id, service_id)
       DO UPDATE SET reason = EXCLUDED.reason, excluded_by_user_id = EXCLUDED.excluded_by_user_id, updated_at = now()`,
      [technicianId, serviceId, reason, adminUserId],
    );

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician.service_excluded',
      entityType: 'technician_profile',
      entityId: technicianId,
      newValues: { service_id: serviceId, service_name_ar: service.name_ar, reason },
      meta,
    });

    return this.listForTechnician(technicianId);
  }

  /** رفع الحجب. Idempotent — رفع حجب مش موجود مالوش أي أثر. */
  async allow(
    adminUserId: string,
    technicianId: string,
    serviceId: string,
    meta?: AuditActorMeta,
  ): Promise<TechnicianServicePermissionRow[]> {
    const removed = await this.dataSource.query<{ reason: string | null }[]>(
      `DELETE FROM technician_excluded_services
        WHERE technician_id = $1 AND service_id = $2
        RETURNING reason`,
      [technicianId, serviceId],
    );

    // مفيش audit لو مفيش حاجة اتشالت فعلاً — سجل مليان "رفع حجب" لحاجات مش محجوبة أصلاً بيغرق
    // الأحداث الحقيقية.
    if (removed.length > 0) {
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'technician.service_allowed',
        entityType: 'technician_profile',
        entityId: technicianId,
        oldValues: { service_id: serviceId, reason: removed[0].reason },
        meta,
      });
    }

    return this.listForTechnician(technicianId);
  }
}
