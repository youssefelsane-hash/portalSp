import {
  deriveAssignmentSource,
  deriveMatchingWorkflowState,
  MatchingWorkflowInput,
} from './matching-workflow-state';
import { OrderStatus } from '../orders/entities/order.entity';

const NOW = new Date('2026-09-03T14:07:00Z');
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000);
const secondsAhead = (n: number) => new Date(NOW.getTime() + n * 1000);

const input = (over: Partial<MatchingWorkflowInput> = {}): MatchingWorkflowInput => ({
  orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
  currentRound: 2,
  roundExpansionDueAt: secondsAhead(30),
  pendingInCurrentRound: 5,
  maxRounds: 4,
  graceSeconds: 60,
  now: NOW,
  ...over,
});

/**
 * القاعدة دي هي اللي صفحة الطلب وصفحة الفني وOperations وException Center **كلهم** بيقروا منها.
 * لو اتكسرت، الأربعة بيكذبوا مع بعض — فالاختبار هنا بيقفل الحالات الحدّية اللي بتفرق فعلاً.
 */
describe('اشتقاق حالة الـmatching workflow — الخطوة الجاية والتأخير', () => {
  it('طلب مش بيدوّر على فني: مفيش خطوة منتظرة، ومستحيل يتقال عليه متأخر', () => {
    const state = deriveMatchingWorkflowState(input({ orderStatus: OrderStatus.IN_PROGRESS }));
    expect(state.phase).toBe('not_matching');
    expect(state.isDelayed).toBe(false);
    expect(state.nextActionAt).toBeNull();
  });

  it('بيدوّر بس لسه ما اتوزّعش: not_dispatched مش «متأخر»', () => {
    const state = deriveMatchingWorkflowState(input({ currentRound: 0, roundExpansionDueAt: null }));
    expect(state.phase).toBe('not_dispatched');
    expect(state.isDelayed).toBe(false);
  });

  it('وقت التوسيع لسه جاي: مستني رد الفنيين، والوقت ده هو الخطوة الجاية', () => {
    const due = secondsAhead(30);
    const state = deriveMatchingWorkflowState(input({ roundExpansionDueAt: due }));
    expect(state.phase).toBe('awaiting_technician_response');
    expect(state.nextActionAt).toEqual(due);
    expect(state.isDelayed).toBe(false);
    expect(state.delaySeconds).toBe(0);
  });

  it('عدّى وقت التوسيع جوّه مهلة السماح: due مش delayed — الـqueue لسه ليها فرصة', () => {
    const state = deriveMatchingWorkflowState(input({ roundExpansionDueAt: secondsAgo(45) }));
    expect(state.phase).toBe('round_expansion_due');
    expect(state.delaySeconds).toBe(45);
    expect(state.isDelayed).toBe(false);
  });

  it('عدّى وقت التوسيع بعد مهلة السماح: DELAYED بمقدار التأخير الحقيقي', () => {
    const state = deriveMatchingWorkflowState(input({ roundExpansionDueAt: secondsAgo(136) }));
    expect(state.phase).toBe('round_expansion_due');
    expect(state.delaySeconds).toBe(136);
    expect(state.isDelayed).toBe(true);
  });

  it('على حدود المهلة بالظبط: لسه مش متأخر — الحد شامل', () => {
    const state = deriveMatchingWorkflowState(input({ roundExpansionDueAt: secondsAgo(60) }));
    expect(state.delaySeconds).toBe(60);
    expect(state.isDelayed).toBe(false);
  });

  it('وصل سقف الجولات: exhausted مش delayed مهما طال الوقت — ده وضع نهائي مش تأخير', () => {
    const state = deriveMatchingWorkflowState(
      input({ currentRound: 4, maxRounds: 4, roundExpansionDueAt: secondsAgo(9000) }),
    );
    expect(state.phase).toBe('rounds_exhausted');
    expect(state.isDelayed).toBe(false);
    // ده الفرق الجوهري عن `stale_dispatch` القديم اللي كان بيولّع على الحالة دي كمان.
    expect(state.delaySeconds).toBe(0);
  });

  it('عروض قايمة مع وقت توسيع مفقود: بيرجع «مستني رد» مش تأخير مبني على بيانات ناقصة', () => {
    const state = deriveMatchingWorkflowState(
      input({ roundExpansionDueAt: null, pendingInCurrentRound: 3 }),
    );
    expect(state.phase).toBe('awaiting_technician_response');
    expect(state.isDelayed).toBe(false);
  });
});

describe('اشتقاق مصدر الإسناد — من الحقيقة المحفوظة، بلا عمود جديد', () => {
  const base = {
    technicianId: 'tech-1',
    providerLockSource: null,
    revisitPinnedTechnicianId: null,
    hasAdminAssignmentHistory: false,
  };

  it('مفيش فني: not_assigned', () => {
    expect(deriveAssignmentSource({ ...base, technicianId: null })).toBe('not_assigned');
  });

  it('مفيش قفل ولا إعادة زيارة ولا أدمن: مطابقة تلقائية', () => {
    expect(deriveAssignmentSource(base)).toBe('auto_match');
  });

  it('قفل منفّذ من الحجز: العميل اختار بنفسه', () => {
    expect(deriveAssignmentSource({ ...base, providerLockSource: 'booking_preview' })).toBe('customer_selected');
  });

  it('قفل بعد عرض السعر: مصدر مستقل عن اختيار الحجز', () => {
    expect(deriveAssignmentSource({ ...base, providerLockSource: 'post_quote_selection' })).toBe(
      'post_quote_selection',
    );
  });

  it('إعادة زيارة مثبّتة على نفس الفني المعيّن', () => {
    expect(deriveAssignmentSource({ ...base, revisitPinnedTechnicianId: 'tech-1' })).toBe('revisit_pinned');
  });

  it('تثبيت إعادة زيارة على فني تاني مايخصّش الإسناد الحالي', () => {
    expect(deriveAssignmentSource({ ...base, revisitPinnedTechnicianId: 'tech-9' })).toBe('auto_match');
  });

  it('الأدمن بيغلب أي إسناد سابق — لأنه آخر قرار حصل فعليًا', () => {
    expect(
      deriveAssignmentSource({
        ...base,
        providerLockSource: 'booking_preview',
        revisitPinnedTechnicianId: 'tech-1',
        hasAdminAssignmentHistory: true,
      }),
    ).toBe('admin_assignment');
  });
});
