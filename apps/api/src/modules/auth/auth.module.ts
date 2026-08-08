import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TwilioSmsDispatcher } from '../../common/notifications/twilio-sms-dispatcher.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OtpCode } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OtpCode, RefreshToken, Role, UserRole]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // الأسرار والصلاحية بيتحددوا لحظة التوقيع في AuthService، مش هنا
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TwilioSmsDispatcher],
  exports: [AuthService],
})
export class AuthModule {}
