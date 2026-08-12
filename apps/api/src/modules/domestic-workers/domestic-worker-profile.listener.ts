import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../common/events/user-registered.event';
import { UserType } from '../auth/entities/user.entity';
import { DomesticWorkerProfile } from './entities/domestic-worker-profile.entity';

// نفس نمط TechnicianProfileListener بالحرف — بروفايل فاضي (specialties=[]) بيتعمل فور التسجيل،
// الشغالة/المربية تكمّله بعدين عبر PATCH /domestic-worker/profile قبل ما تطلب المراجعة.
@Injectable()
export class DomesticWorkerProfileListener {
  private readonly logger = new Logger(DomesticWorkerProfileListener.name);

  constructor(
    @InjectRepository(DomesticWorkerProfile) private readonly profiles: Repository<DomesticWorkerProfile>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    if (event.userType !== UserType.DOMESTIC_WORKER) return;

    const existing = await this.profiles.findOne({ where: { userId: event.userId } });
    if (existing) return;

    const [{ next_human_readable_number: workerCode }] = await this.dataSource.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('DW')");

    const profile = this.profiles.create({ userId: event.userId, workerCode });
    await this.profiles.save(profile);
    this.logger.log(`domestic_worker_profiles اتعمل لـ user ${event.userId} برقم ${workerCode}`);
  }
}
