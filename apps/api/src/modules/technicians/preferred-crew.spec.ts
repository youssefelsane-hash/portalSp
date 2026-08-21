import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { PreferredCrewMemberStatus, TechnicianPreferredCrewMember } from './entities/technician-preferred-crew-member.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { PreferredCrewService } from './preferred-crew.service';

// اختبار حي ضد Postgres حقيقي — الفريق المفضّل (docs/08 §36.16، ADR-0022). شبكة تفضيل نظير-لنظير
// دائمة، اتجاه واحد بس (owner→member)، صفر موافقة أدمن — منفصلة تمامًا عن order_team_members/
// technician_companies/assistant_link_status.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

describe('PreferredCrewService — الفريق المفضّل (docs/08 §36.16، ADR-0022)', () => {
  let dataSource: DataSource;
  let service: PreferredCrewService;
  const runId = Date.now().toString(36);
  const ids = { ownerUser: '', ownerProfile: '', memberUser: '', memberProfile: '', otherUser: '', otherProfile: '' };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function makeTechnician(label: string) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2048${runId}${label}`.slice(0, 15),
      `فني فريق مفضّل ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'professional','approved',true) RETURNING id`,
      [user.id, `TCPCM${label}${runId}`.slice(0, 20)],
    );
    return { userId: user.id as string, profileId: profile.id as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianProfile, TechnicianPreferredCrewMember],
    });
    await dataSource.initialize();

    const owner = await makeTechnician('owner');
    ids.ownerUser = owner.userId;
    ids.ownerProfile = owner.profileId;
    const member = await makeTechnician('member');
    ids.memberUser = member.userId;
    ids.memberProfile = member.profileId;
    const other = await makeTechnician('other');
    ids.otherUser = other.userId;
    ids.otherProfile = other.profileId;

    service = new PreferredCrewService(
      dataSource.getRepository(TechnicianPreferredCrewMember),
      dataSource.getRepository(TechnicianProfile),
      settingsServiceStub,
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_preferred_crew_members WHERE owner_technician_id = ANY($1::uuid[]) OR member_technician_id = ANY($1::uuid[])`, [
        [ids.ownerProfile, ids.memberProfile, ids.otherProfile],
      ]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.ownerProfile, ids.memberProfile, ids.otherProfile]]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('invite() — يرفض دعوة النفس', async () => {
    await expect(service.invite(ids.ownerUser, (await dataSource.query(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.ownerProfile]))[0].technician_code)).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });

  it('invite() — يرفض كود فني مش موجود', async () => {
    await expect(service.invite(ids.ownerUser, 'NOTEXIST123')).rejects.toMatchObject({ code: 'VAL_001' });
  });

  let invitationId = '';

  it('invite() — دعوة ناجحة (status=invited)', async () => {
    const [memberRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.memberProfile]);
    const invitation = await service.invite(ids.ownerUser, memberRow.technician_code);
    invitationId = invitation.id;
    expect(invitation.status).toBe(PreferredCrewMemberStatus.INVITED);
  });

  it('invite() — نفس الزوج ده تاني (لسه invited) يترفض بتعارض', async () => {
    const [memberRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.memberProfile]);
    await expect(service.invite(ids.ownerUser, memberRow.technician_code)).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('listInvitationsReceived() — الفني التاني (مش المدعو) مايشوفش الدعوة دي', async () => {
    const rows = await service.listInvitationsReceived(ids.otherUser);
    expect(rows.find((r) => r.id === invitationId)).toBeUndefined();
  });

  it('listInvitationsReceived() — المدعو بيشوف الدعوة المعلّقة', async () => {
    const rows = await service.listInvitationsReceived(ids.memberUser);
    expect(rows.some((r) => r.id === invitationId)).toBe(true);
  });

  it('accept() — فني مش صاحب الدعوة يترفض', async () => {
    await expect(service.accept(ids.otherUser, invitationId)).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('accept() — المدعو بيقبل، الحالة تبقى accepted', async () => {
    const row = await service.accept(ids.memberUser, invitationId);
    expect(row.status).toBe(PreferredCrewMemberStatus.ACCEPTED);
    expect(row.respondedAt).not.toBeNull();
  });

  it('listMine() — العضو المقبول ظاهر في قايمة الـowner', async () => {
    const rows = await service.listMine(ids.ownerUser);
    expect(rows.some((r) => r.technicianId === ids.memberProfile && r.status === PreferredCrewMemberStatus.ACCEPTED)).toBe(true);
  });

  it('accept() تاني على نفس الدعوة (بقت accepted بالفعل) يترفض — مش invited تاني', async () => {
    await expect(service.accept(ids.memberUser, invitationId)).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('leave() — العضو يمشي من تلقاء نفسه', async () => {
    await service.leave(ids.memberUser, invitationId);
    const rows = await service.listMine(ids.ownerUser);
    expect(rows.find((r) => r.id === invitationId)).toBeUndefined();
  });

  it('بعد المغادرة — دعوة جديدة لنفس الزوج ممكنة (صف جديد، مش تعارض مع القديم المُزال)', async () => {
    const [memberRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.memberProfile]);
    const invitation = await service.invite(ids.ownerUser, memberRow.technician_code);
    expect(invitation.status).toBe(PreferredCrewMemberStatus.INVITED);
    await service.decline(ids.memberUser, invitation.id);
    const declined = await q(`SELECT status FROM technician_preferred_crew_members WHERE id = $1`, [invitation.id]);
    expect(declined[0].status).toBe('declined');
  });

  it('remove() — الـowner بيشيل دعوة معلّقة، مش لازم موافقة المدعو', async () => {
    const [memberRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.memberProfile]);
    const invitation = await service.invite(ids.ownerUser, memberRow.technician_code);
    await service.remove(ids.ownerUser, invitation.id);
    const removed = await q(`SELECT status FROM technician_preferred_crew_members WHERE id = $1`, [invitation.id]);
    expect(removed[0].status).toBe('removed');
  });

  it('getAcceptedMemberIds() — بيرجّع بس الأعضاء المقبولين حاليًا', async () => {
    const [memberRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.memberProfile]);
    const invitation = await service.invite(ids.ownerUser, memberRow.technician_code);
    await service.accept(ids.memberUser, invitation.id);
    const ids2 = await service.getAcceptedMemberIds(ids.ownerProfile);
    expect(ids2.has(ids.memberProfile)).toBe(true);
    expect(ids2.has(ids.otherProfile)).toBe(false);
    await service.remove(ids.ownerUser, invitation.id);
  });

  it('حد أقصى قابل للتعديل — إعداد أقصى حجم=1 بيمنع دعوة تانية بعد أول عضو مقبول', async () => {
    const limitedSettings = { getNumber: async () => 1 } as unknown as SettingsService;
    const limitedService = new PreferredCrewService(
      dataSource.getRepository(TechnicianPreferredCrewMember),
      dataSource.getRepository(TechnicianProfile),
      limitedSettings,
    );
    const [memberRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.memberProfile]);
    const [otherRow] = await q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [ids.otherProfile]);
    const invitation = await limitedService.invite(ids.ownerUser, memberRow.technician_code);
    await limitedService.accept(ids.memberUser, invitation.id);
    await expect(limitedService.invite(ids.ownerUser, otherRow.technician_code)).rejects.toMatchObject({ code: 'VAL_001' });
    await limitedService.remove(ids.ownerUser, invitation.id);
  });
});
