import { IsUUID } from 'class-validator';

export class TransferOwnershipDto {
  @IsUUID()
  new_owner_user_id: string;
}
