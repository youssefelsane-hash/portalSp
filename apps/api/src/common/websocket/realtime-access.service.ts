import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../exceptions/api.exception';
import { User } from '../../modules/auth/entities/user.entity';
import { JwtPayload } from '../../modules/auth/types/authenticated-request';

@Injectable()
export class RealtimeAccessService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async authenticate(token: unknown): Promise<JwtPayload> {
    if (typeof token !== 'string' || token.length === 0) this.reject();
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      this.reject();
    }
    await this.assertActive(payload!);
    return payload!;
  }

  async assertActive(payload: JwtPayload): Promise<User> {
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.isBlocked || user.userType !== payload.userType) this.reject();
    return user;
  }

  private reject(): never {
    throw new ApiException(ErrorCode.AUTH_001, 'الحساب أو الجلسة غير متاحة', HttpStatus.UNAUTHORIZED);
  }
}
