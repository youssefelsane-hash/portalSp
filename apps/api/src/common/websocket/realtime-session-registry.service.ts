import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { Socket } from 'socket.io';

interface PgNotification {
  channel: string;
  payload?: string;
}

interface PgNotificationConnection {
  on(event: 'notification', listener: (message: PgNotification) => void): void;
  removeListener(event: 'notification', listener: (message: PgNotification) => void): void;
}

const REVOCATION_CHANNEL = 'baytak_realtime_access_revoked';

/**
 * **سقف الـsockets المتزامنة للمستخدم الواحد** (تدقيق شامل 2026-09-20).
 *
 * كان مفيش سقف خالص: قِستها حيًّا — مستخدم واحد بتوكن واحد فتح **٣٠٠ socket في 462ms** بلا أي
 * مقاومة. الـthrottler بتاع الـHTTP (`THROTTLE_LIMIT`, 60/دقيقة) **مابيغطّيش** الـWebSocket
 * handshake خالص، فمفيش أي حاجة كانت بتحدّ العدد. وكل اتصال بيعمل استعلام DB (`assertActive`)
 * وبيفضل ماسك مدخل في الـMaps دي، فالتكلفة تراكمية مش لحظية.
 *
 * محتاج توكن صالح — يعني مش هجوم من مجهول — بس هو رافعة تضخيم لحساب واحد متسرّب.
 *
 * **٢٠ ليه**: مستخدم حقيقي بيفتح ٢–٤ (تتبّع + شات، وممكن الويب والموبايل مع بعض)؛ ٢٠ بتسيب
 * مساحة واسعة لأجهزة متعددة وإعادة اتصال بعد قطع شبكة، وبرضه بتحوّل «٣٠٠ ومفيش حد» لرقم مقفول.
 */
const MAX_SOCKETS_PER_USER = Math.max(1, parseInt(process.env.REALTIME_MAX_SOCKETS_PER_USER ?? '20', 10) || 20);

@Injectable()
export class RealtimeSessionRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeSessionRegistry.name);
  private readonly socketsByUser = new Map<string, Set<Socket>>();
  private readonly rateWindows = new Map<string, Map<string, number[]>>();
  private queryRunner: QueryRunner | null = null;
  private notificationConnection: PgNotificationConnection | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private readonly onNotification = (message: PgNotification): void => {
    if (message.channel === REVOCATION_CHANNEL && message.payload) {
      this.disconnectUser(message.payload, 'تم تغيير حالة الحساب أو صلاحياته');
    }
  };

  async onModuleInit(): Promise<void> {
    this.queryRunner = this.dataSource.createQueryRunner();
    await this.queryRunner.connect();
    const runner = this.queryRunner as QueryRunner & { databaseConnection: PgNotificationConnection };
    this.notificationConnection = runner.databaseConnection;
    this.notificationConnection.on('notification', this.onNotification);
    await this.queryRunner.query(`LISTEN ${REVOCATION_CHANNEL}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queryRunner) return;
    this.notificationConnection?.removeListener('notification', this.onNotification);
    if (!this.queryRunner.isReleased) {
      await this.queryRunner.query(`UNLISTEN ${REVOCATION_CHANNEL}`).catch((error: unknown) => {
        this.logger.warn(`تعذر إلغاء LISTEN أثناء الإغلاق: ${error instanceof Error ? error.message : String(error)}`);
      });
      await this.queryRunner.release();
    }
    this.queryRunner = null;
    this.notificationConnection = null;
  }

  register(userId: string, socket: Socket): void {
    const sockets = this.socketsByUser.get(userId) ?? new Set<Socket>();
    sockets.add(socket);
    this.socketsByUser.set(userId, sockets);
    this.evictOldestBeyondCap(userId, sockets);
  }

  /**
   * **بنفصل الأقدم مش بنرفض الجديد — عمدًا.**
   *
   * رفض الاتصال الجديد أسهل، بس بيكسر مستخدم حقيقي: `Set` في الجافاسكريبت بيفضل ماسك sockets
   * «زومبي» لحد ما `handleDisconnect` يجري، وده ممكن يتأخر بعد قطع شبكة مفاجئ. يعني عميل قطعت
   * نت عنده ورجع بسرعة كان ممكن يلاقي نفسه **مقفول برّه** بسقف مليان بجلسات ميتة — وده يخالف
   * قاعدة CLAUDE.md إن أي حماية مالهاش حق تعلّق العملية الحقيقية للمستخدم.
   *
   * بالفصل من الأقدم: المستخدم الحقيقي دايمًا بيعدّي (جلسته الجديدة هي الناجية)، والمتعسّف
   * بيلف على نفسه — الأثر ثابت عند السقف مهما فتح.
   *
   * ترتيب `Set` في جافاسكريبت هو ترتيب الإدخال، فأول عنصر = أقدم socket، بلا أي تتبّع زيادة.
   */
  private evictOldestBeyondCap(userId: string, sockets: Set<Socket>): void {
    if (sockets.size <= MAX_SOCKETS_PER_USER) return;
    const overflow = sockets.size - MAX_SOCKETS_PER_USER;
    let evicted = 0;
    for (const oldest of sockets) {
      if (evicted >= overflow) break;
      sockets.delete(oldest);
      this.rateWindows.delete(oldest.id);
      try {
        oldest.emit('error', { code: 'AUTH_001', message: 'اتفتحت جلسة أحدث — الجلسة دي اتقفلت' });
        oldest.disconnect(true);
      } catch {
        // الـsocket ممكن يكون مقفول أصلاً — المهم إنه اتشال من الخريطة فوق.
      }
      evicted += 1;
    }
    this.logger.warn(
      `المستخدم ${userId} عدّى سقف ${MAX_SOCKETS_PER_USER} socket — اتفصل ${evicted} من الأقدم`,
    );
  }

  unregister(userId: string | undefined, socket: Socket): void {
    if (userId) {
      const sockets = this.socketsByUser.get(userId);
      sockets?.delete(socket);
      if (sockets?.size === 0) this.socketsByUser.delete(userId);
    }
    this.rateWindows.delete(socket.id);
  }

  disconnectUser(userId: string, message: string): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    for (const socket of sockets) {
      socket.emit('error', { code: 'AUTH_001', message });
      socket.disconnect(true);
    }
    this.socketsByUser.delete(userId);
  }

  /**
   * "أونلاين دلوقتي" (docs/08 §35.10، ADR-0021 §6) — observability بحت، بيقرأ نفس الـMap
   * الموجودة أصلاً بلا أي تخزين جديد. **تحذير معماري متعمّد**: الـMap دي in-memory محلية لكل
   * process — في نشر بأكتر من instance/pod، فني متصل بـinstance تاني هيظهر "أوفلاين" هنا رغم
   * إنه متصل فعليًا. مقبول حاليًا (نفس حجم النشر الحالي)، وموثّق صراحة عشان أي سيشن مستقبلية
   * تعرف الفجوة دي لو النشر اتوسّع لأكتر من instance — مش سهو.
   */
  isUserOnline(userId: string): boolean {
    const sockets = this.socketsByUser.get(userId);
    return !!sockets && sockets.size > 0;
  }

  /** كل الـuserIds المتصلين دلوقتي عبر أي socket (تتبع/شات/أي namespace تاني بيستخدم نفس الـregistry). */
  onlineUserIds(): string[] {
    return [...this.socketsByUser.keys()];
  }

  consumeRateLimit(socketId: string, event: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const socketWindows = this.rateWindows.get(socketId) ?? new Map<string, number[]>();
    const recent = (socketWindows.get(event) ?? []).filter((timestamp) => timestamp > now - windowMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    socketWindows.set(event, recent);
    this.rateWindows.set(socketId, socketWindows);
    return true;
  }
}
