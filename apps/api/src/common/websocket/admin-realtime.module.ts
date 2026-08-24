import { Module } from '@nestjs/common';
import { AdminRealtimeGateway } from './admin-realtime.gateway';
import { RealtimeSecurityModule } from './realtime-security.module';

// وحدة بث الأدمن الحي — بتغلف الـgateway مع بنية الأمان المشتركة (RealtimeAccess +
// SessionRegistry) بدل ما نسجّل الـgateway مباشرة في AppModule من غير سياق موديول.
@Module({
  imports: [RealtimeSecurityModule],
  providers: [AdminRealtimeGateway],
})
export class AdminRealtimeModule {}
