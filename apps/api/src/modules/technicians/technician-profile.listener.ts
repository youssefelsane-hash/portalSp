import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../common/events/user-registered.event';
import { UserType } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';

@Injectable()
export class TechnicianProfileListener {
  private readonly logger = new Logger(TechnicianProfileListener.name);

  constructor(
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    if (event.userType !== UserType.TECHNICIAN) return;

    const existing = await this.technicianProfiles.findOne({ where: { userId: event.userId } });
    if (existing) return;

    // technician_code بيتولد من sequence في الداتابيز (infra/migrations/0017) — مضمون عدم التكرار
    const [{ next_technician_code: technicianCode }] = await this.dataSource.query<
      { next_technician_code: string }[]
    >('SELECT next_technician_code()');

    const profile = this.technicianProfiles.create({ userId: event.userId, technicianCode });
    await this.technicianProfiles.save(profile);
    this.logger.log(`technician_profiles اتعمل لـ user ${event.userId} برقم ${technicianCode}`);
  }
}
