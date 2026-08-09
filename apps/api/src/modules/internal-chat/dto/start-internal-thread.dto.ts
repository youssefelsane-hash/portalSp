import { IsUUID } from 'class-validator';

export class StartInternalThreadDto {
  @IsUUID()
  peer_user_id: string;
}
