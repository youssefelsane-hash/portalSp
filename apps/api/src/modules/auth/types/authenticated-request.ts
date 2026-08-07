import { Request } from 'express';
import { UserType } from '../entities/user.entity';

export interface JwtPayload {
  sub: string; // user id
  userType: UserType;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
