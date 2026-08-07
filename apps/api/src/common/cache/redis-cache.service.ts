import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// طبقة كاش خفيفة فوق Redis — مش مصدر الحقيقة أبداً، مجرد تسريع قراءة. أي فشل (Redis واقع،
// شبكة، ...) بيتلقّط ويترجع كأنه cache miss عادي، مش استثناء — القاعدة (المصدر الحقيقي)
// لازم تفضل شغالة حتى لو الكاش نفسه مش متاح.
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('redis.url')!, {
      lazyConnect: true,
      // فشل الأمر نفسه بسرعة (مفيش انتظار طويل يعطّل الطلب الحقيقي)، بس الاتصال يفضل يحاول
      // يرجع لوحده في الخلفية — لو مانفصلناش retryStrategy، الكاش هيفضل ميت للأبد حتى لو
      // Redis رجع شغال، لحد ما البروسيس نفسه يعيد التشغيل.
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
    this.client.connect().catch((err) => this.logger.warn(`فشل الاتصال بـ Redis وقت البدء: ${err.message}`));
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(`فشلت قراءة الكاش لـ ${key}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`فشلت كتابة الكاش لـ ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`فشل إبطال الكاش لـ ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
