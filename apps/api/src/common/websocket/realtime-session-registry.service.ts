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
