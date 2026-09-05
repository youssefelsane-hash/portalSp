import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import {
  SETTING_RELOAD_REQUIRED_EVENT,
  SETTING_UPDATED_EVENT,
  SettingUpdatedEvent,
} from './setting-updated.event';

interface PgNotification {
  channel: string;
  payload?: string;
}

interface PgNotificationConnection {
  on(event: 'notification', listener: (message: PgNotification) => void): void;
  removeListener(event: 'notification', listener: (message: PgNotification) => void): void;
}

/** نفس نمط `RealtimeSessionRegistry` بالحرف — بدائي واحد للتواصل بين النسخ، مش اتنين. */
const SETTING_CHANNEL = 'baytak_setting_updated';

interface SettingNotifyPayload {
  /** نسخة الـprocess اللي أطلقت التغيير — عشان مانعيدش تحميل نفسنا بلا داعي. */
  i: string;
  k: string;
}

/**
 * **جسر تغيير الإعدادات بين النسخ** (تدقيق A-3).
 *
 * ## المشكلة اللي بيحلها
 *
 * `EventEmitter2` كله in-process. لمعظم الـ٧٨ مستمع ده **السلوك الصح** — مستمع بيكتب في
 * القاعدة أو بيبعت إشعار لازم يشتغل **مرة واحدة**، وتشغيله على كل نسخة هو البَقّة مش الحل.
 * والبث اللحظي للعملاء بقى عابرًا للنسخ من غير أحداث أصلاً (Socket.IO Redis adapter، ADR-0073).
 *
 * بس فيه فئة واحدة **مكسورة فعلاً**: الخدمات اللي **ماسكة قيمة الإعداد في ذاكرتها**. الأدمن
 * بيغيّر مفاتيح Paymob على نسخة A ⇒ نسخة A بس هي اللي بتعيد التحميل. نسخة B بتفضل تحصّل
 * بالمفاتيح **القديمة** لحد ما الـprocess يترستِرت — فشل صامت جزئي على نص حركة الدفع، بلا أي
 * خطأ في اللوج.
 *
 * الكاش نفسه مش المشكلة (`SettingsService` بيبطّل مفتاحه في Redis المشترك، فأي قراءة جديدة
 * على أي نسخة بترجع القيمة الجديدة) — المشكلة إن الحقول دي **مابتتقراش تاني** أصلاً.
 *
 * ## ليه مش جسر عام لكل الأحداث
 *
 * نقل الـ٦٠ حدث كلهم على Redis pub/sub كان هيحوّل «مرة واحدة» لـ«مرة لكل نسخة»: إشعارات
 * مكررة، مكافآت إحالة مضاعفة، إعادة حساب إحصاءات N مرة. **التنفيذ مرة واحدة على النسخة
 * الباعثة هو الضمانة، مش القيد.** فالجسر ده **مقصور على فئة واحدة**: تحميل من الذاكرة، آمن
 * التكرار (idempotent)، وأثره داخل النسخة بس.
 *
 * ## ليه LISTEN/NOTIFY مش Redis pub/sub
 *
 * المشروع فيه بالفعل بدائي عابر للنسخ شغّال ومختبر — إبطال الجلسات في
 * `RealtimeSessionRegistry` (Postgres `LISTEN/NOTIFY`). إضافة قناة تانية بنفس الآلية أرخص من
 * إدخال آلية تانية بضمانات وأنماط فشل مختلفة. وPostgres موجود بالضرورة في كل مسار كتابة إعداد
 * أصلاً — لو هو واقع، مافيش تغيير إعداد من الأساس.
 *
 * ## أنماط الفشل
 *
 * فشل الـ`NOTIFY` **مابيكسرش حفظ الإعداد** — بيتسجّل تحذير والحفظ بيكمل (نفس قاعدة
 * `queue.add()` الموثّقة). أسوأ حالة: النسخ التانية تفضل بقيمة قديمة زي ما كانت قبل الجسر ده
 * بالظبط، يعني **صفر تراجع** عن السلوك الحالي.
 */
@Injectable()
export class SettingsCrossInstanceBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsCrossInstanceBridge.name);
  /** معرّف الـprocess ده — بيتولّد مرة واحدة عند الإقلاع. */
  private readonly instanceId = randomUUID();
  private queryRunner: QueryRunner | null = null;
  private notificationConnection: PgNotificationConnection | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  private readonly onNotification = (message: PgNotification): void => {
    if (message.channel !== SETTING_CHANNEL || !message.payload) return;
    let parsed: SettingNotifyPayload;
    try {
      parsed = JSON.parse(message.payload) as SettingNotifyPayload;
    } catch {
      this.logger.warn(`إشعار إعداد بصيغة غير متوقّعة: ${message.payload}`);
      return;
    }
    // النسخة اللي أطلقت التغيير عملت التحميل بالفعل عبر SETTING_UPDATED_EVENT المحلي.
    if (!parsed.k || parsed.i === this.instanceId) return;
    // القيمة مش بتتنقل عمدًا — أسرار (مفاتيح البوابات) مالهاش لازمة تعدّي في قناة إشعار،
    // والمستمع بيعيد القراءة من `SettingsService` أصلاً (الكاش المشترك اتبطّل قبل الإشعار ده).
    this.events.emit(SETTING_RELOAD_REQUIRED_EVENT, new SettingUpdatedEvent(parsed.k, undefined));
  };

  async onModuleInit(): Promise<void> {
    try {
      this.queryRunner = this.dataSource.createQueryRunner();
      await this.queryRunner.connect();
      const runner = this.queryRunner as QueryRunner & { databaseConnection: PgNotificationConnection };
      this.notificationConnection = runner.databaseConnection;
      this.notificationConnection.on('notification', this.onNotification);
      await this.queryRunner.query(`LISTEN ${SETTING_CHANNEL}`);
    } catch (error: unknown) {
      // مافيش سبب يمنع الـAPI من الإقلاع لأن قناة مزامنة إعدادات مافتحتش — السلوك بيرجع
      // لـ«نسخة واحدة» زي ما كان بالظبط.
      this.logger.warn(`تعذّر فتح قناة مزامنة الإعدادات: ${error instanceof Error ? error.message : String(error)}`);
      this.queryRunner = null;
      this.notificationConnection = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queryRunner) return;
    this.notificationConnection?.removeListener('notification', this.onNotification);
    if (!this.queryRunner.isReleased) {
      await this.queryRunner.query(`UNLISTEN ${SETTING_CHANNEL}`).catch((error: unknown) => {
        this.logger.warn(`تعذّر إلغاء LISTEN أثناء الإغلاق: ${error instanceof Error ? error.message : String(error)}`);
      });
      await this.queryRunner.release();
    }
    this.queryRunner = null;
    this.notificationConnection = null;
  }

  /**
   * الاتجاه المحلي ⇐ باقي النسخ. مابيعيدش الإطلاق محليًا — المستمعين المحليين اتنفّذوا
   * بالفعل من نفس الحدث ده.
   */
  @OnEvent(SETTING_UPDATED_EVENT)
  async broadcast(event: SettingUpdatedEvent): Promise<void> {
    const payload: SettingNotifyPayload = { i: this.instanceId, k: event.key };
    try {
      await this.dataSource.query(`SELECT pg_notify($1, $2)`, [SETTING_CHANNEL, JSON.stringify(payload)]);
    } catch (error: unknown) {
      this.logger.warn(
        `تعذّر إبلاغ باقي النسخ بتغيير الإعداد ${event.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
