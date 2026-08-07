import { UserType } from '../../modules/auth/entities/user.entity';

export const USER_REGISTERED_EVENT = 'user.registered';

// auth بيصدر الحدث ده بس — مش بيعرف ولا بيستدعي customers/technicians مباشرة (حدود الموديولات، §2.4)
export class UserRegisteredEvent {
  constructor(
    public readonly userId: string,
    public readonly userType: UserType,
    public readonly phoneNumber: string,
    public readonly fullName: string,
  ) {}
}
