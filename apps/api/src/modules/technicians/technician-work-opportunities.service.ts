import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianCapacityTier } from './technician-eligibility.sql';

export type WorkOpportunityStatus = 'offered' | 'accepted' | 'declined' | 'closed';
export type WorkOpportunityContext = 'assignment' | 'crew_recruit';
export type CrewRecruitRole = 'technician' | 'assistant';

export interface WorkOpportunityRow {
  id: string;
  order_id: string;
  technician_id: string;
  capacity_tier_at_offer: TechnicianCapacityTier;
  status: WorkOpportunityStatus;
  offered_at: string;
  decided_at: string | null;
  context: WorkOpportunityContext;
  crew_role: CrewRecruitRole | null;
}

export interface WorkOpportunityListItem extends WorkOpportunityRow {
  order_number: string;
  service_name_ar: string;
  problem_description: string | null;
  street_name: string;
  scheduled_at: string | null;
  /** بس لفرص crew_recruit — اسم قائد الطلب اللي بيتم التجنيد تحته (docs/08 §35). */
  team_leader_name?: string | null;
}

export interface WorkOpportunityAdminRow extends WorkOpportunityRow {
  technician_code: string;
  technician_full_name: string;
}

/**
 * طبقة بيانات لطلبات الشغل الإضافي الاختيارية (docs/08 §34.1، ADR-0020 §2) — جدول
 * `technician_work_opportunities` مفهوش TypeORM entity (نفس نمط `technician_categories` — SQL
 * خام مباشر، الجدول بسيط بلا حاجة لـrepository كامل). راجع MatchingService لمنطق العرض/القبول
 * الفعلي (القرار "مين يتعرضله" وإعادة الفحص وقت القبول تحت قفل — هنا مجرد CRUD على الصف).
 */
@Injectable()
export class TechnicianWorkOpportunitiesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * إنشاء عرض جديد — idempotent عبر القيد الفريد الجزئي (`uq_technician_work_opportunities_
   * offered`، migration 0153): لو عرض `offered` حي موجود بالفعل لنفس الطلب/الفني، بيرجّع نفس
   * الصف بدل ما يكرره أو يرمي خطأ. `created` في الرد بيفرّق "صف جديد فعلاً" عن "كان موجود بالفعل"
   * — الكولر (docs/08 §36.1) بيستخدمها عشان يبعت إشعار مرة واحدة بس، مش كل مرة الدالة دي تتنادى
   * idempotent-بشكل بلا داعي.
   */
  async offerIfNotExists(
    manager: EntityManager,
    orderId: string,
    technicianId: string,
    tier: TechnicianCapacityTier,
    context: WorkOpportunityContext = 'assignment',
    crewRole: CrewRecruitRole | null = null,
  ): Promise<WorkOpportunityRow & { created: boolean }> {
    const [existing] = await manager.query<WorkOpportunityRow[]>(
      `SELECT * FROM technician_work_opportunities
       WHERE order_id = $1 AND technician_id = $2 AND status = 'offered' AND deleted_at IS NULL`,
      [orderId, technicianId],
    );
    if (existing) return { ...existing, created: false };

    const [created] = await manager.query<WorkOpportunityRow[]>(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status, context, crew_role)
       VALUES ($1,$2,$3,'offered',$4,$5)
       ON CONFLICT (order_id, technician_id) WHERE status = 'offered' AND deleted_at IS NULL DO NOTHING
       RETURNING *`,
      [orderId, technicianId, tier, context, crewRole],
    );
    if (created) return { ...created, created: true };
    // سباق نادر: صف تاني خلق نفس العرض بين الـSELECT والـINSERT — نرجع نقرأه بدل ما نفشل. created:false
    // عمدًا — الصف التاني (اللي فعلاً كتب الـINSERT) هو المسؤول عن إشعاره بنفسه، مش إحنا.
    const [race] = await manager.query<WorkOpportunityRow[]>(
      `SELECT * FROM technician_work_opportunities
       WHERE order_id = $1 AND technician_id = $2 AND status = 'offered' AND deleted_at IS NULL`,
      [orderId, technicianId],
    );
    return { ...race, created: false };
  }

  /** هل فيه عرض `offered` حي لأي فني على الطلب ده؟ — نفس فكرة `liveAssignments` في dispatchNextRound(). */
  async hasLiveOfferForOrder(orderId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM technician_work_opportunities WHERE order_id = $1 AND status = 'offered' AND deleted_at IS NULL
       ) AS exists`,
      [orderId],
    );
    return rows[0].exists;
  }

  /** فرص "تعيين قائد" بس (السلوك الأصلي، migration 0153) — context='assignment'. فرص تجنيد الفريق
   * (context='crew_recruit') ليها استعلام/شاشة منفصلة (docs/08 §35/§35.4) — أثرهم عند القبول
   * مختلف جوهريًا (يبقى قائد VS ينضم كعضو)، عرضهم في نفس القايمة/زرار القبول القديم هيدّي واجهة
   * مضلّلة (زرار "قبول" هيرمي خطأ واضح بدل ما ينضم فعلاً — راجع matching.service.ts's
   * acceptWorkOpportunity()). */
  async listForTechnician(technicianId: string): Promise<WorkOpportunityListItem[]> {
    return this.dataSource.query<WorkOpportunityListItem[]>(
      `SELECT wo.*, o.order_number, s.name_ar AS service_name_ar, o.problem_description, a.street_name, o.scheduled_at
       FROM technician_work_opportunities wo
       JOIN orders o ON o.id = wo.order_id
       JOIN services s ON s.id = o.service_id
       JOIN addresses a ON a.id = o.address_id
       WHERE wo.technician_id = $1 AND wo.status = 'offered' AND wo.deleted_at IS NULL AND wo.context = 'assignment'
       ORDER BY wo.offered_at DESC`,
      [technicianId],
    );
  }

  /** فرص تجنيد الفريق (docs/08 §35) — الفني بيتعرضله ينضم كعضو تحت قائد موجود بالفعل. */
  async listCrewRecruitForTechnician(technicianId: string): Promise<WorkOpportunityListItem[]> {
    return this.dataSource.query<WorkOpportunityListItem[]>(
      `SELECT wo.*, o.order_number, s.name_ar AS service_name_ar, o.problem_description, a.street_name, o.scheduled_at,
              leader_u.full_name AS team_leader_name
       FROM technician_work_opportunities wo
       JOIN orders o ON o.id = wo.order_id
       JOIN services s ON s.id = o.service_id
       JOIN addresses a ON a.id = o.address_id
       LEFT JOIN technician_profiles leader_tp ON leader_tp.id = o.technician_id
       LEFT JOIN users leader_u ON leader_u.id = leader_tp.user_id
       WHERE wo.technician_id = $1 AND wo.status = 'offered' AND wo.deleted_at IS NULL AND wo.context = 'crew_recruit'
       ORDER BY wo.offered_at DESC`,
      [technicianId],
    );
  }

  /**
   * كل تاريخ الفرص لطلب معيّن (docs/08 §34.4، ADR-0020 §W) — شفافية أدمن: "ليه الطلب ده اتوزّع
   * بالشكل ده" — مين اتعرضله فرصة، بأي تصنيف قدرة استيعابية وقتها، وقرر إيه (قبل/رفض/لسه مستني/
   * اتقفلت لأن الطلب اتغطى من حتة تانية).
   */
  async listForOrderAdmin(orderId: string): Promise<WorkOpportunityAdminRow[]> {
    return this.dataSource.query<WorkOpportunityAdminRow[]>(
      `SELECT wo.*, tp.technician_code, u.full_name AS technician_full_name
       FROM technician_work_opportunities wo
       JOIN technician_profiles tp ON tp.id = wo.technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE wo.order_id = $1 AND wo.deleted_at IS NULL
       ORDER BY wo.offered_at DESC`,
      [orderId],
    );
  }

  /** عرض `offered` مملوك للفني ده — بيرمي واضح لو مش موجود/مش ملكه/مش offered خالص. */
  async getOwnedOfferedOrThrow(manager: EntityManager, technicianId: string, opportunityId: string): Promise<WorkOpportunityRow> {
    const [row] = await manager.query<WorkOpportunityRow[]>(
      `SELECT * FROM technician_work_opportunities WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [opportunityId],
    );
    if (!row || row.technician_id !== technicianId || row.status !== 'offered') {
      throw new ApiException(ErrorCode.VAL_001, 'الفرصة دي مش متاحة لك دلوقتي', HttpStatus.CONFLICT);
    }
    return row;
  }

  async markDecided(manager: EntityManager, opportunityId: string, status: 'accepted' | 'declined'): Promise<void> {
    await manager.query(
      `UPDATE technician_work_opportunities SET status = $2, decided_at = now() WHERE id = $1`,
      [opportunityId, status],
    );
  }

  /**
   * لما الطلب يتغطى بالكامل (تأكيد تلقائي لفني تاني، أو قبول فرصة من الفني ده نفسه) — أي عروض
   * `offered` تانية حية على نفس الطلب تتقفل (`closed`، مش `declined` — الفني مارفضش، الفرصة
   * ببساطة بقت مش موجودة). `exceptOpportunityId` اختياري عشان العرض اللي اتقبل فعلاً ميتلمسش هنا
   * (الـcaller بيحدّثه لـ`accepted` بنداء منفصل، `markDecided`).
   */
  async closeRemainingForOrder(manager: EntityManager, orderId: string, exceptOpportunityId?: string): Promise<void> {
    await manager.query(
      `UPDATE technician_work_opportunities
       SET status = 'closed', decided_at = now()
       WHERE order_id = $1 AND status = 'offered' AND id IS DISTINCT FROM $2::uuid`,
      [orderId, exceptOpportunityId ?? null],
    );
  }
}
