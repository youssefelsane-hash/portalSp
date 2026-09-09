import { Global, Module } from '@nestjs/common';
import { RequestMetricsService } from './request-metrics.service';

/**
 * `@Global` عن قصد: الـinterceptor العام (`APP_INTERCEPTOR`) بيتحقن في جذر التطبيق، والخدمة
 * لازم تكون **نفس النسخة** اللي `OpsMetricsService` بيقرا منها — نسختين معناهما عدّادات فاضية
 * في الرد وإنذار مطمئن كاذب.
 */
@Global()
@Module({
  providers: [RequestMetricsService],
  exports: [RequestMetricsService],
})
export class ObservabilityModule {}
