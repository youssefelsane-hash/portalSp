import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianScheduleSlot } from './entities/technician-schedule-slot.entity';
import { TechnicianScheduleService } from './technician-schedule.service';

describe('Technician schedule exclusion constraint', () => {
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
      [`+2031${runId}`.slice(0, 15), `فني جدول ${runId}`],
    );
    ids.user = user.id;
    const [technician] = await dataSource.query(
      `INSERT INTO technician_profiles (user_id,technician_code,verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [ids.user, `SCH${runId}`.slice(0, 20)],
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

  it('طلبا إنشاء متداخلان بالتوازي: قيد PostgreSQL يسمح بواحد فقط', async () => {
    const outcomes = await Promise.allSettled([
      service.createSlot(ids.technician, {
        slot_date: '2099-06-01',
        start_time: '09:00',
        end_time: '11:00',
      }),
      service.createSlot(ids.technician, {
        slot_date: '2099-06-01',
        start_time: '10:00',
        end_time: '12:00',
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(await dataSource.getRepository(TechnicianScheduleSlot).count({ where: { technicianId: ids.technician } })).toBe(1);
  });

  it('الفترات المتجاورة غير متداخلة وتبقى مسموحة', async () => {
    await service.createSlot(ids.technician, {
      slot_date: '2099-06-02',
      start_time: '09:00',
      end_time: '10:00',
    });
    await service.createSlot(ids.technician, {
      slot_date: '2099-06-02',
      start_time: '10:00',
      end_time: '11:00',
    });
    const count = await dataSource.getRepository(TechnicianScheduleSlot).count({
      where: { technicianId: ids.technician, slotDate: '2099-06-02' },
    });
    expect(count).toBe(2);
  });
});
