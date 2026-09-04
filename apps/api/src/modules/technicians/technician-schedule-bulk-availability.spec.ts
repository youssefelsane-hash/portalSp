import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from './entities/technician-schedule-slot.entity';
import { TechnicianScheduleService } from './technician-schedule.service';

// تعديل جماعي سريع للإتاحة (docs/08 §34.3) — نطاق تاريخ/أسبوع/شهر كامل بنداء واحد. اختبار حي ضد
// Postgres حقيقي (مش mocks) عشان قيد الـexclusion الحقيقي (migration 0118) يتفحص فعليًا مش بافتراض.
describe('TechnicianScheduleService.bulkSetAvailability — تعديل جماعي سريع للإتاحة', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechnicianScheduleService;
  const runId = Date.now().toString(36);
  const ids = { user: '', technician: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, TechnicianScheduleSlot],
    });
    await dataSource.initialize();
    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2032${runId}`.slice(0, 15), `فني جماعي ${runId}`],
    );
    ids.user = user.id;
    const [technician] = await dataSource.query(
      `INSERT INTO technician_profiles (user_id,technician_code,verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [ids.user, `BLK${runId}`.slice(0, 20)],
    );
    ids.technician = technician.id;
    service = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await dataSource.query(`DELETE FROM technician_schedule_slots WHERE technician_id=$1`, [ids.technician]);
      await dataSource.query(`DELETE FROM technician_profiles WHERE id=$1`, [ids.technician]);
      await dataSource.query(`DELETE FROM users WHERE id=$1`, [ids.user]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('block على نطاق تواريخ بينشئ صف blocked كامل اليوم لكل تاريخ', async () => {
    const dates = ['2099-07-01', '2099-07-02', '2099-07-03'];
    const results = await service.bulkSetAvailability(ids.technician, dates, 'block');
    expect(results).toEqual(dates.map((date) => ({ date, status: 'applied' })));

    const slots = await dataSource
      .getRepository(TechnicianScheduleSlot)
      .find({ where: { technicianId: ids.technician }, order: { slotDate: 'ASC' } });
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.status).toBe(TechnicianScheduleSlotStatus.BLOCKED);
      expect(slot.startTime).toBe('00:00:00');
      expect(slot.endTime).toBe('23:59:59');
    }
  });

  it('unblock بيمسح الاستثناء ويرجّع اليوم للافتراضي (غياب أي صف = متاح)', async () => {
    await service.bulkSetAvailability(ids.technician, ['2099-07-10'], 'block');
    let count = await dataSource
      .getRepository(TechnicianScheduleSlot)
      .count({ where: { technicianId: ids.technician, slotDate: '2099-07-10' } });
    expect(count).toBe(1);

    const results = await service.bulkSetAvailability(ids.technician, ['2099-07-10'], 'unblock');
    expect(results).toEqual([{ date: '2099-07-10', status: 'applied' }]);

    count = await dataSource
      .getRepository(TechnicianScheduleSlot)
      .count({ where: { technicianId: ids.technician, slotDate: '2099-07-10' } });
    expect(count).toBe(0);
  });

  it('يوم فيه سلوت booked فعلي بيتستبعد (skipped_booked) بلا لمس أي حاجة', async () => {
    const slot = dataSource.getRepository(TechnicianScheduleSlot).create({
      technicianId: ids.technician,
      slotDate: '2099-07-20',
      startTime: '09:00:00',
      endTime: '11:00:00',
      status: TechnicianScheduleSlotStatus.BOOKED,
      orderId: null,
    });
    await dataSource.getRepository(TechnicianScheduleSlot).save(slot);

    const results = await service.bulkSetAvailability(ids.technician, ['2099-07-20'], 'block');
    expect(results).toEqual([{ date: '2099-07-20', status: 'skipped_booked' }]);

    const stillBooked = await dataSource.getRepository(TechnicianScheduleSlot).findOne({ where: { id: slot.id } });
    expect(stillBooked?.status).toBe(TechnicianScheduleSlotStatus.BOOKED);
  });

  it('استدعاء block مرتين على نفس اليوم idempotent (بلا خطأ قيد exclusion)', async () => {
    await service.bulkSetAvailability(ids.technician, ['2099-07-25'], 'block');
    await expect(service.bulkSetAvailability(ids.technician, ['2099-07-25'], 'block')).resolves.toEqual([
      { date: '2099-07-25', status: 'applied' },
    ]);
    const count = await dataSource
      .getRepository(TechnicianScheduleSlot)
      .count({ where: { technicianId: ids.technician, slotDate: '2099-07-25' } });
    expect(count).toBe(1);
  });

  it('block بيستبدل سلوتات available جزئية موجودة بصف blocked كامل اليوم واحد', async () => {
    await service.createSlot(ids.technician, { slot_date: '2099-07-30', start_time: '09:00', end_time: '12:00' });
    await service.createSlot(ids.technician, { slot_date: '2099-07-30', start_time: '13:00', end_time: '17:00' });
    const count = await dataSource
      .getRepository(TechnicianScheduleSlot)
      .count({ where: { technicianId: ids.technician, slotDate: '2099-07-30' } });
    expect(count).toBe(2);

    await service.bulkSetAvailability(ids.technician, ['2099-07-30'], 'block');
    const slots = await dataSource
      .getRepository(TechnicianScheduleSlot)
      .find({ where: { technicianId: ids.technician, slotDate: '2099-07-30' } });
    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe(TechnicianScheduleSlotStatus.BLOCKED);
  });
});
