import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

// **الأنواع مشتقّة من `IoAdapter` نفسه، مش مستوردة من `socket.io` مباشرة.**
// `@nestjs/platform-socket.io` مثبّت `socket.io` على `4.8.1` بالظبط (مش `^`)، والجذر عنده
// `4.8.3` — فnpm بيحط نسخة متداخلة، والنوعان مش متطابقين بنيويًا رغم إنهم نفس المكتبة. وقت
// التشغيل فيه سيرفر واحد بس، فالفرق نوعي بحت. الاشتقاق بـ`Parameters`/`ReturnType` بيخلّي
// التوقيع مطابق للأساس تلقائيًا بدل ما نكسر تثبيت المكتبة أو نستخدم `any`.
type IoServer = ReturnType<IoAdapter['createIOServer']>;
type CloseTarget = Parameters<IoAdapter['close']>[0];
type CreateServerOptions = Parameters<IoAdapter['createIOServer']>[1];

/**
 * **بث الغرف عبر أكتر من instance (تدقيق C-4).**
 *
 * من غير الـadapter ده، `server.to(room).emit(...)` بتوصل **بس** للـsockets المتصلة بنفس
 * الـprocess. يعني أول ما النظام يشتغل على replica تانية:
 *   • الفني متصل بـA بيبعت موقعه، والعميل متصل بـB ⇒ العميل **مايشوفش الفني بيتحرّك أبدًا**.
 *   • `admin:live` و`chat:message_received` نفس الحكاية.
 * والأخطر إن ده **فشل صامت**: مفيش استثناء، مفيش لوج، مجرد شاشة ساكنة. الـadapter بيخلّي كل
 * instance تنشر أحداث الغرف على Redis pub/sub والباقي يستقبلوها ويبثّوها لـsockets عندهم.
 *
 * **ليه الفشل مايوقفش الإقلاع** (نفس فلسفة `RedisCacheService` بالحرف، وقاعدة CLAUDE.md: أي فشل
 * في infra يتلقّط ويترجع لسلوك آمن): لو Redis مش متاح وقت الإقلاع، بنسجّل تحذير صريح ونكمّل
 * بالـadapter الافتراضي (in-process). النتيجة وقتها = سلوك النظام النهارده بالظبط (instance
 * واحد شغّال تمام)، مش انهيار. الـAPI بتفضل تقدّم كل مسارات REST والـWebSocket المحلية.
 *
 * **الاتصالان منفصلان عمدًا**: بروتوكول Redis pub/sub بيحط الاتصال المشترِك في وضع subscriber
 * فمايقدرش ينفّذ أوامر عادية — فلازم اتصال للنشر واتصال للاشتراك، وده شرط المكتبة نفسها مش
 * اختيار. وكلاهما منفصل عن اتصال `RedisCacheService` وعن اتصالات BullMQ.
 */
export class RedisIoAdapter extends IoAdapter {
  private static readonly logger = new Logger(RedisIoAdapter.name);

  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  /**
   * بيحاول يوصل Redis ويجهّز الـadapter. بيرجّع `true` لو نجح، و`false` لو Redis مش متاح
   * (والحالة التانية **مش خطأ** — بنكمّل in-process).
   */
  async connect(): Promise<boolean> {
    // `lazyConnect` عشان نتحكم في لحظة الاتصال ونقدر نلقط فشله هنا بدل ما يطلع كحدث غير متوقّع.
    // `maxRetriesPerRequest: null` مطلوب للاتصال اللي بيفضل مشترك طول العمر — القيمة الافتراضية
    // بترمي بعد عدد محاولات فتكسر الاشتراك نهائيًا بدل ما يستنى رجوع Redis.
    const make = (role: string): Redis => {
      const client = new Redis(this.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => Math.min(times * 200, 5000),
      });
      client.on('error', (err) => RedisIoAdapter.logger.warn(`اتصال ${role} خطأ: ${err.message}`));
      return client;
    };

    const pubClient = make('pub');
    const subClient = make('sub');
    this.clients = [pubClient, subClient];

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      RedisIoAdapter.logger.log('بث الغرف اللحظي متوصّل على Redis — التوسّع لأكتر من instance مدعوم');
      return true;
    } catch (err) {
      RedisIoAdapter.logger.warn(
        `تعذّر توصيل Redis لبث الغرف (${err instanceof Error ? err.message : String(err)}) — ` +
          'الـAPI هتكمل بالبث المحلي داخل الـprocess. ده كافي تمامًا لـinstance واحد، لكن مع أكتر ' +
          'من instance البث مش هيعبر بينهم.',
      );
      this.adapterConstructor = null;
      await this.closeRedisClients();
      return false;
    }
  }

  createIOServer(port: number, options?: CreateServerOptions): IoServer {
    const server = super.createIOServer(port, options) as IoServer;
    // `null` = الاتصال فشل فوق؛ بنسيب الـadapter الافتراضي (in-process) زي ما هو.
    if (this.adapterConstructor) {
      // الـcast هنا بسبب نسختَي `socket.io` المشروحتين فوق: `createAdapter` مبنية على نسخة
      // الجذر، والسيرفر ده من النسخة المتداخلة. نفس الكلاس وقت التشغيل.
      server.adapter(this.adapterConstructor as unknown as Parameters<IoServer['adapter']>[0]);
    }
    return server;
  }

  /**
   * Nest بينده `close()` على الـadapter وقت إغلاق التطبيق (`app.close()` / SIGTERM مع
   * `enableShutdownHooks`)، فده المكان الصح لقفل اتصالَي Redis — من غيره الاتصالين بيفضلوا
   * مفتوحين ويمنعوا الـprocess من الخروج النظيف.
   */
  async close(server: CloseTarget): Promise<void> {
    await super.close(server);
    await this.closeRedisClients();
  }

  private async closeRedisClients(): Promise<void> {
    await Promise.all(
      this.clients.map((client) =>
        client.quit().catch(() => {
          // الاتصال ممكن يكون واقع أصلاً — `quit()` بترمي وقتها، والقفل القسري كافي.
          client.disconnect();
        }),
      ),
    );
    this.clients = [];
  }
}
