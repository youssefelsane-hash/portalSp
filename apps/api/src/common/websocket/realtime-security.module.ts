import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../modules/auth/entities/user.entity';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeSessionRegistry } from './realtime-session-registry.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), JwtModule.register({})],
  providers: [RealtimeAccessService, RealtimeSessionRegistry],
  exports: [RealtimeAccessService, RealtimeSessionRegistry],
})
export class RealtimeSecurityModule {}
