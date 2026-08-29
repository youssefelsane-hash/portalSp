import { KpiSnapshotStatus } from './entities/technician-kpi-snapshot.entity';
import { TechnicianKpiService } from './technician-kpi.service';

describe('TechnicianKpiService.getTechnicianSummary', () => {
  function setup() {
    const snapshots = {
      find: jest.fn().mockResolvedValue([]),
    };
    const service = new TechnicianKpiService(
      snapshots as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, snapshots };
  }

  it('hides calculated snapshots from the technician app', async () => {
    const { service, snapshots } = setup();

    await service.getTechnicianSummary('tech-1', true);

    const options = snapshots.find.mock.calls[0][0] as {
      where: { technicianId: string; status: { _type: string; _value: KpiSnapshotStatus[] } };
    };
    expect(options.where.technicianId).toBe('tech-1');
    expect(options.where.status._type).toBe('in');
    expect(options.where.status._value).toEqual([
      KpiSnapshotStatus.APPROVED,
      KpiSnapshotStatus.PAID,
      KpiSnapshotStatus.REJECTED,
    ]);
  });

  it('keeps all statuses available to the admin detail view', async () => {
    const { service, snapshots } = setup();

    await service.getTechnicianSummary('tech-1');

    expect(snapshots.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { technicianId: 'tech-1' } }),
    );
  });
});
