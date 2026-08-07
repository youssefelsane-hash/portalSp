import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../common/events/user-registered.event';
import { UserType } from '../auth/entities/user.entity';
import { CustomerProfile } from './entities/customer-profile.entity';

@Injectable()
export class CustomerProfileListener {
  private readonly logger = new Logger(CustomerProfileListener.name);

  constructor(@InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    if (event.userType !== UserType.CUSTOMER) return;

    const existing = await this.customerProfiles.findOne({ where: { userId: event.userId } });
    if (existing) return;

    const profile = this.customerProfiles.create({ userId: event.userId });
    await this.customerProfiles.save(profile);
    this.logger.log(`customer_profiles اتعمل لـ user ${event.userId}`);
  }
}
