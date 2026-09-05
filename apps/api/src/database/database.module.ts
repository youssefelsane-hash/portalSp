import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DbPoolMonitorService } from './db-pool-monitor.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        autoLoadEntities: true,
        // الـ schema بيتحدد بس من infra/migrations — ممنوع TypeORM يعدّل الجداول لوحده
        synchronize: false,
        migrationsRun: false,
        extra: {
          // **الإعداد ده كان غايب تمامًا، والافتراضيات هي اللي حوّلت زحمة لتعليق دائم.**
          //
          // `max` الافتراضي في node-postgres عشرة — نفس الرقم اللي شفناه في `pg_stat_activity`
          // وقت العطل. خلّيناه صريح عشان يبقى قابل للضبط والقياس، **مش عشان نكبّره هربًا من
          // المشكلة**: السبب الجذري كان دورة بتحجز اتصال طول عمرها (اتصلح في `sweep-lock.ts`)،
          // وأي pool مهما كبر كان هيتاكل بنفس الطريقة.
          max: config.get<number>('database.poolMax'),
          // **الأهم**: من غير المهلة دي، `pool.connect()` بيستنى **للأبد** لما الـpool يتملي.
          // ده اللي خلّى العطل «تعليق أبدي محتاج إعادة تشغيل» بدل أخطاء صريحة سريعة. بعدها،
          // أسوأ حالة هي أخطاء واضحة في اللوج مع مسار كودها — تشخيص في دقيقة بدل يوم.
          connectionTimeoutMillis: config.get<number>('database.acquireTimeoutMs'),
          // اتصال خامل بيتقفل بعد المدة دي بدل ما يفضل ماسك مكان في الـpool.
          idleTimeoutMillis: config.get<number>('database.idleTimeoutMs'),
        },
      }),
    }),
  ],
  providers: [DbPoolMonitorService],
  exports: [DbPoolMonitorService],
})
export class DatabaseModule {}
