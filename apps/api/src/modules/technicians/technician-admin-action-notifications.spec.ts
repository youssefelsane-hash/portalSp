import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TECHNICIAN_ADMIN_ACTION_EVENT,
  TechnicianAdminActionEvent,
} from '../../common/events/technician-admin-action.event';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechnicianCompaniesService } from './technician-companies.service';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianLevel, TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianPricingTier } from './entities/technician-profile.entity';

/**
 * بلاغ المالك (docs/08 §64.هـ): «لما الأدمين يعمل أي أكشن، المفروض يوصل للصنايعي notification».
 *
 * انتقالات حالة التوثيق كان عندها أحداث من قبل — اللي كان **ساكت تمامًا** هو الأكشنات اللي
 * بتمسّ فلوس الفني وسمعته: علامة التوثيق، المستوى، فئة التسعير، مراجعة المستندات، ومعامل سعر
 * الشركة. الاختبار ده بيمسك كل واحد فيهم على حدة عشان مايرجعوش يسكتوا تاني.
 *
 * وحدات مقصودة (مش قاعدة بيانات): كل المطلوب إثباته هو إن الأكشن **بيصدر حدث لصاحبه بالنص
 * الصح** — التسليم نفسه مغطّى بمسار NotificationsService المختبَر أصلاً.
 */
describe('إشعارات أكشنات الأدمن على الفني/الشركة (docs/08 §64.هـ)', () => {
  const TECH_USER = '00000000-0000-7000-8000-00000000c001';
  const TECH_PROFILE = '00000000-0000-7000-8000-00000000c002';
  const OWNER_USER = '00000000-0000-7000-8000-00000000c003';
  const COMPANY = '00000000-0000-7000-8000-00000000c004';

  function captured(): { events: TechnicianAdminActionEvent[]; emitter: EventEmitter2 } {
    const events: TechnicianAdminActionEvent[] = [];
    const emitter = new EventEmitter2();
    emitter.on(TECHNICIAN_ADMIN_ACTION_EVENT, (event: TechnicianAdminActionEvent) => events.push(event));
    return { events, emitter };
  }

  function profile(overrides: Partial<TechnicianProfile> = {}): TechnicianProfile {
    return Object.assign(new TechnicianProfile(), {
      id: TECH_PROFILE,
      userId: TECH_USER,
      isTrustVerified: false,
      currentLevel: TechnicianLevel.NEW,
      pricingTier: 'standard' as TechnicianPricingTier,
      qualityScore: 0,
      ...overrides,
    });
  }

  function techService(stored: TechnicianProfile, emitter: EventEmitter2): AdminTechniciansService {
    const svc = Object.create(AdminTechniciansService.prototype) as AdminTechniciansService;
    Object.assign(svc, {
      events: emitter,
      auditLog: { record: async () => undefined },
      technicianProfiles: { save: async (p: TechnicianProfile) => p, findOne: async () => stored },
      levelHistory: { create: (x: unknown) => x, save: async (x: unknown) => x },
      findProfileOrThrow: async () => stored,
      attachUsers: async (rows: TechnicianProfile[]) => rows,
    });
    return svc;
  }

  it('منح علامة التوثيق بيوصل الفني بنص واضح (كان بيتم في صمت — فجوة موثّقة قبل كده)', async () => {
    const { events, emitter } = captured();
    const stored = profile();
    await techService(stored, emitter).setTrustBadge('admin', TECH_PROFILE, { granted: true } as never);
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(TECH_USER);
    expect(events[0].kind).toBe('trust_badge_granted');
    expect(events[0].referenceType).toBe('technician_profile');
  });

  it('سحب علامة التوثيق بيوصل بالسبب، وبيقول صراحة إنه مش بيمنع الشغل (ADR-0039)', async () => {
    const { events, emitter } = captured();
    const stored = profile({ isTrustVerified: true });
    await techService(stored, emitter).setTrustBadge('admin', TECH_PROFILE, {
      granted: false,
      note: 'شكوى متكررة',
    } as never);
    expect(events[0].kind).toBe('trust_badge_revoked');
    expect(events[0].bodyAr).toContain('شكوى متكررة');
    expect(events[0].bodyAr).toContain('مش بيمنعك من الشغل');
  });

  it('الترقية والتخفيض بيتفرّقوا في نوع الإشعار — المستوى بيغيّر نصيب الفني فعلاً (ADR-0040)', async () => {
    const promotion = captured();
    await techService(profile(), promotion.emitter).changeLevel('admin', TECH_PROFILE, {
      level: TechnicianLevel.PREMIUM,
    } as never);
    expect(promotion.events[0].kind).toBe('level_promoted');

    const demotion = captured();
    await techService(profile({ currentLevel: TechnicianLevel.PREMIUM }), demotion.emitter).changeLevel(
      'admin',
      TECH_PROFILE,
      { level: TechnicianLevel.NEW, reason: 'تقييمات منخفضة' } as never,
    );
    expect(demotion.events[0].kind).toBe('level_demoted');
    expect(demotion.events[0].bodyAr).toContain('تقييمات منخفضة');
  });

  it('رفض مستند بيوصل بسبب الرفض عشان الفني يعرف يصلّح إيه', async () => {
    const { events, emitter } = captured();
    const stored = profile();
    const svc = techService(stored, emitter);
    Object.assign(svc, {
      documents: {
        findOne: async () => ({
          id: 'doc-1',
          technicianId: TECH_PROFILE,
          reviewStatus: 'pending',
          documentType: 'national_id',
        }),
        save: async (d: unknown) => d,
      },
    });
    await svc.reviewDocument('admin', TECH_PROFILE, 'doc-1', {
      review_status: 'rejected',
      rejection_reason: 'الصورة مش واضحة',
    } as never);
    expect(events[0].kind).toBe('document_rejected');
    expect(events[0].bodyAr).toContain('الصورة مش واضحة');
  });

  it('تغيير معامل سعر الشركة (ADR-0042) بيوصل صاحبها بالقيمة القديمة والجديدة', async () => {
    const { events, emitter } = captured();
    const company = Object.assign(new TechnicianCompany(), {
      id: COMPANY,
      ownerUserId: OWNER_USER,
      name: 'شركة الاختبار',
      priceMultiplier: 1,
    });
    const svc = Object.create(TechnicianCompaniesService.prototype) as TechnicianCompaniesService;
    Object.assign(svc, {
      events: emitter,
      auditLog: { record: async () => undefined },
      companies: { findOne: async () => company, save: async (c: unknown) => c },
    });
    await svc.setPriceMultiplier('admin', COMPANY, 1.2, 'جودة أعلى');
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(OWNER_USER);
    expect(events[0].kind).toBe('company_price_multiplier_changed');
    expect(events[0].bodyAr).toContain('×1.2');
    expect(events[0].referenceType).toBe('technician_company');
  });
});
