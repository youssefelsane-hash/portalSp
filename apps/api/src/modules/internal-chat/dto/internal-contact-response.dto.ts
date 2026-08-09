import { UserType } from '../../auth/entities/user.entity';
import { InternalContact } from '../internal-chat.service';

export interface InternalContactResponseDto {
  user_id: string;
  full_name: string;
  user_type: UserType;
}

export function toInternalContactResponseDto(contact: InternalContact): InternalContactResponseDto {
  return { user_id: contact.userId, full_name: contact.fullName, user_type: contact.userType };
}
