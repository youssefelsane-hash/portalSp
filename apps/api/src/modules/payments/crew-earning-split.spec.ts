import { CrewParticipant, splitCrewEarnings } from './crew-earning-split';

// ADR-0040 / docs/08 §63.أ3 — نص المالك: «يبقى سعر الحاجة اللي اتعملت ده هو المية في المية،
// ويتقسم بقى على الناس كلها حسب كل واحد والليفل بتاعه».

const p = (id: string, role: CrewParticipant['participantRole'], weight: number, level = 'professional'): CrewParticipant => ({
  technicianId: id,
  participantRole: role,
  technicianLevel: level,
  shareWeight: weight,
});

const total = (shares: { shareCents: number }[]) => shares.reduce((s, x) => s + x.shareCents, 0);

describe('توزيع مستحقات الطاقم بوزن المستوى (ADR-0040)', () => {
  it('فني واحد بس: بياخد الوعاء كله', () => {
    const shares = splitCrewEarnings(100_000, [p('lead', 'leader', 1.25)]);
    expect(shares).toHaveLength(1);
    expect(shares[0].shareCents).toBe(100_000);
  });

  it('قائد + عضو بنفس الوزن: نص ونص', () => {
    const shares = splitCrewEarnings(100_000, [p('lead', 'leader', 1), p('m1', 'team_member', 1)]);
    expect(shares.map((s) => s.shareCents)).toEqual([50_000, 50_000]);
  });

  it('الوزن الأعلى بياخد أكتر — قائد فريق (1.6) مع فني جديد (1.0)', () => {
    const shares = splitCrewEarnings(130_000, [
      p('lead', 'leader', 1.6, 'team_leader'),
      p('m1', 'team_member', 1.0, 'new'),
    ]);
    // 1.6/2.6 = 80000، 1.0/2.6 = 50000
    expect(shares[0].shareCents).toBe(80_000);
    expect(shares[1].shareCents).toBe(50_000);
    expect(total(shares)).toBe(130_000);
  });

  it('المساعد بياخد حصة بوزن مستواه هو، مش صفر', () => {
    const shares = splitCrewEarnings(100_000, [
      p('lead', 'leader', 1.45, 'premium'),
      p('a1', 'assistant', 1.0, 'new'),
    ]);
    expect(shares[1].shareCents).toBeGreaterThan(0);
    expect(shares[1].participantRole).toBe('assistant');
  });

  it('**الضمانة الأهم**: المجموع = الوعاء بالظبط مهما كان التقريب', () => {
    // أرقام مقصودة عشان تكسر القسمة (3 مشاركين بأوزان كسرية على مبلغ فردي)
    const shares = splitCrewEarnings(100_001, [
      p('lead', 'leader', 1.6),
      p('m1', 'team_member', 1.25),
      p('m2', 'team_member', 1.1),
    ]);
    expect(total(shares)).toBe(100_001);
  });

  it('باقي التقريب بيروح للقائد مش لحد تاني', () => {
    const shares = splitCrewEarnings(100, [p('lead', 'leader', 1), p('m1', 'team_member', 1), p('m2', 'team_member', 1)]);
    // 100/3 = 33 لكل واحد، والباقي 1 للقائد
    expect(shares.find((s) => s.participantRole === 'leader')!.shareCents).toBe(34);
    expect(shares.filter((s) => s.participantRole !== 'leader').map((s) => s.shareCents)).toEqual([33, 33]);
    expect(total(shares)).toBe(100);
  });

  it('وعاء صفر (طلب مجاني/ملغي): كل الحصص صفر، بلا استثناء', () => {
    const shares = splitCrewEarnings(0, [p('lead', 'leader', 1.6), p('m1', 'team_member', 1)]);
    expect(shares.map((s) => s.shareCents)).toEqual([0, 0]);
  });

  it('وعاء سالب (مفروض ما يحصلش): بيتعامل كصفر مش كقيمة سالبة', () => {
    const shares = splitCrewEarnings(-5000, [p('lead', 'leader', 1)]);
    expect(shares[0].shareCents).toBe(0);
  });

  it('مفيش مشاركين: قايمة فاضية بلا استثناء', () => {
    expect(splitCrewEarnings(100_000, [])).toEqual([]);
  });

  it('إعداد أدمن غلط (كل الأوزان صفر): قسمة بالتساوي بدل قسمة على صفر', () => {
    const shares = splitCrewEarnings(90_000, [p('lead', 'leader', 0), p('m1', 'team_member', 0), p('m2', 'team_member', 0)]);
    expect(shares.map((s) => s.shareCents)).toEqual([30_000, 30_000, 30_000]);
    expect(total(shares)).toBe(90_000);
  });

  it('طاقم كبير (6 أفراد بأوزان مختلفة): المجموع مضبوط ومحدش بياخد سالب', () => {
    const shares = splitCrewEarnings(777_777, [
      p('lead', 'leader', 1.6),
      p('m1', 'team_member', 1.45),
      p('m2', 'team_member', 1.25),
      p('m3', 'team_member', 1.1),
      p('a1', 'assistant', 1.0),
      p('a2', 'assistant', 1.0),
    ]);
    expect(total(shares)).toBe(777_777);
    expect(shares.every((s) => s.shareCents >= 0)).toBe(true);
  });

  it('أجر المساعد المحدد يتضرب في مستوى المساعد، والفنيون يقسمون المتبقي فقط', () => {
    const shares = splitCrewEarnings(100_000, [
      p('lead', 'leader', 1.6, 'team_leader'),
      {
        ...p('a1', 'assistant', 0.65, 'professional'),
        assistantBaseWageCents: 20_000,
        assistantLevelMultiplier: 1.25,
        assistantTargetCents: 25_000,
      },
    ]);

    expect(shares.find((share) => share.technicianId === 'a1')).toMatchObject({
      shareCents: 25_000,
      calculationMethod: 'assistant_level_wage',
    });
    expect(shares.find((share) => share.technicianId === 'lead')!.shareCents).toBe(75_000);
    expect(total(shares)).toBe(100_000);
  });

  it('إعداد أجر مساعد أكبر من الوعاء يرجع للتوزيع النسبي الآمن بلا قرش مخلوق أو طرف بصفر', () => {
    const shares = splitCrewEarnings(20_000, [
      p('lead', 'leader', 1.6),
      { ...p('a1', 'assistant', 0.65), assistantTargetCents: 30_000 },
    ]);

    expect(shares.every((share) => share.shareCents > 0)).toBe(true);
    expect(shares.every((share) => share.calculationMethod === 'weighted_pool')).toBe(true);
    expect(total(shares)).toBe(20_000);
  });
});
