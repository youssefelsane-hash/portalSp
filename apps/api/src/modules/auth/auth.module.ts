import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TwilioSmsDispatcher } from '../../common/notifications/twilio-sms-dispatcher.service';
import { AdminModule } from '../admin/admin.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminMfaController } from './admin-mfa.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AdminMfaRecoveryCode } from './entities/admin-mfa-recovery-code.entity';
import { OtpCode } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { StepUpToken } from './entities/step-up-token.entity';
import { User } from './entities/user.entity';
import { WebAuthnChallenge } from './entities/webauthn-challenge.entity';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { MfaPolicyService } from './mfa-policy.service';
import { SessionsController } from './sessions.controller';
import { StepUpService } from './step-up.service';
import { WebAuthnController } from './webauthn.controller';
import { WebAuthnService } from './webauthn.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      OtpCode,
      RefreshToken,
      WebAuthnCredential,
      WebAuthnChallenge,
      AdminMfaRecoveryCode,
      StepUpToken,
      Wallet,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // الأسرار والصلاحية بيتحددوا لحظة التوقيع في AuthService، مش هنا
    AdminModule, // PermissionsService — لازم لـMfaPolicyService (فحص High-Privilege حي، ADR-0011)
    NotificationsModule, // NotificationRoutingService — تنبيه super_admin عند استخدام استرجاع MFA
    AuditModule, // AuditLogService — تسجيل عملية admin_mfa.reset (ADR-0011 §6)
  ],
  controllers: [AuthController, WebAuthnController, SessionsController, AdminMfaController],
  providers: [AuthService, JwtStrategy, TwilioSmsDispatcher, MfaPolicyService, WebAuthnService, StepUpService],
  // StepUpService لازم يتصدّر — StepUpGuard مسجّل كـAPP_GUARD عالمي في AppModule نفسه (زي
  // PermissionsGuard/PermissionsService)، فمحتاج يلاقي الـprovider ده في سياق موديول متصدّر.
  exports: [AuthService, StepUpService],
})
export class AuthModule {}
