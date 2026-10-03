import { applyDecisionLimitGate } from './decision-limit-gate';
import { TechnicianBookingListItem } from './technicians.service';

function item(id: string, overrides: Partial<TechnicianBookingListItem> = {}): TechnicianBookingListItem {
  return {
    technicianId: id,
    isCompany: false,
    availabilityStatus: 'available',
    unavailableReasonAr: null,
    availableAgainAt: null,
    decisionLimitCents: null,
    ...overrides,
  } as TechnicianBookingListItem;
}

const entry = (it: TechnicianBookingListItem, amountCents: number | null) => ({ item: it, amountCents });
const ids = (rows: Array<{ item: TechnicianBookingListItem }>) => rows.map((r) => r.item.technicianId);

describe('applyDecisionLimitGate — سقف قرار المستوى في قايمة الاختيار (ADR-0118)', () => {
  const rows = () => [
    entry(item('new', { decisionLimitCents: 20_000 }), 62_400),
    entry(item('pro', { decisionLimitCents: 150_000 }), 62_400),
    entry(item('premium', { decisionLimitCents: null }), 70_000),
    entry(item('busy', { availabilityStatus: 'schedule_conflicted', decisionLimitCents: 20_000 }), 62_400),
  ];

  it('الخدمة بتعرض غير المتاحين والعميل بيفهم الحالة ⇒ اللي فوق سقفه أحمر بسببه، والمتاحين الأول', () => {
    const out = applyDecisionLimitGate(rows(), { showUnavailable: true, includeIneligible: true });
    expect(ids(out)).toEqual(['pro', 'premium', 'new', 'busy']);
    const red = out.find((r) => r.item.technicianId === 'new')!.item;
    expect(red.availabilityStatus).toBe('not_eligible');
    expect(red.unavailableReasonAr).toContain('أكبر من المسموح');
  });

  it('العميل المنشور (من غير include_ineligible) ⇒ بيتشال، عمره ما يوصله «متاح» وهو هيترفض', () => {
    const out = applyDecisionLimitGate(rows(), { showUnavailable: true, includeIneligible: false });
    expect(ids(out)).toEqual(['pro', 'premium', 'busy']);
  });

  it('الخدمة مش بتعرض غير المتاحين ⇒ بيتشال حتى لو العميل بيفهم الحالة', () => {
    const out = applyDecisionLimitGate(rows(), { showUnavailable: false, includeIneligible: true });
    expect(ids(out)).not.toContain('new');
  });

  it('السعر = السقف بالظبط مسموح (المحرك بيرفض لما يزيد بس)', () => {
    const out = applyDecisionLimitGate([entry(item('edge', { decisionLimitCents: 50_000 }), 50_000)], {
      showUnavailable: true,
      includeIneligible: true,
    });
    expect(out[0].item.availabilityStatus).toBe('available');
  });

  it('السعر مش معروف (فورم ناقص) ⇒ مفيش أساس للمقارنة والصف بيفضل زي ما هو', () => {
    const out = applyDecisionLimitGate([entry(item('new', { decisionLimitCents: 20_000 }), null)], {
      showUnavailable: true,
      includeIneligible: true,
    });
    expect(out[0].item.availabilityStatus).toBe('available');
  });

  it('الشركة اللي مفيش عضو فيها سقفه يكفي بتاخد سبب يخص الشركة', () => {
    const out = applyDecisionLimitGate([entry(item('co', { isCompany: true, decisionLimitCents: 20_000 }), 62_400)], {
      showUnavailable: true,
      includeIneligible: true,
    });
    expect(out[0].item.unavailableReasonAr).toContain('في الشركة');
  });
});
