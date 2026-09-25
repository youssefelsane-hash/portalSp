import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, hkdfSync } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

/**
 * **تتبّع أخطاء الواجهة** (ADR-0114).
 *
 * الفجوة: كل رصد الأخطاء كان من ناحية السيرفر (`RequestMetricsService` للـ5xx، و
 * `.dev-logs/errors.log` وهو متوقّف في الإنتاج عمدًا). خطأ في متصفح العميل — رندر مكسور، شبكة
 * قاطعة، استدعاء بيرجع 400 — مكانش بيترك أي أثر، فكنا بنعرف بالمشكلة لما حد يكلّم الدعم.
 *
 * والمخرج مش سجل بنقراه سطر سطر: `summary()` بترد على السؤال اللي المالك صاغه بالحرف — «٣٧
 * مستخدم حصل لهم Error عند اختيار الموعد النهاردة».
 */

export interface ClientErrorSummaryRow {
  fingerprint: string;
  app: string;
  kind: string;
  page_path: string;
  error_name: string | null;
  error_message: string | null;
  api_path: string | null;
  api_status: number | null;
  events: number;
  /** عدد الزوّار المختلفين — الرقم اللي بيحوّل «فيه أخطاء» لـ«٣٧ مستخدم متأثر». */
  visitors: number;
  top_browser: string | null;
  top_device: string | null;
  first_seen: string;
  last_seen: string;
}

/** طول أقصى للمسار المخزّن بعد التطهير — حماية أخيرة لو الـDTO اتخطّى بأي طريقة. */
const MAX_PATH = 300;

@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger(ClientErrorsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /**
   * بيخزّن حدث واحد. **مابيرجّعش أي حاجة ومابيرميش أي استثناء** — المسار العام بيرد `202` دايمًا
   * (ADR-0114 §4.4)، وفشل التخزين ماينفعش يتحول لعطل في الواجهة اللي بتبلّغ عن عطل.
   */
  async record(
    dto: ReportClientErrorDto,
    ctx: { ip: string | null; userAgent: string | null; userId: string | null },
  ): Promise<void> {
    try {
      const pagePath = sanitizePath(dto.page_path);
      const apiPath = dto.api_path ? sanitizePath(dto.api_path) : null;
      const ua = parseUserAgent(ctx.userAgent);
      const fingerprint = createHash('sha256')
        .update([dto.app, dto.kind, pagePath, dto.error_name ?? '', apiPath ?? '', dto.api_status ?? ''].join('|'))
        .digest('hex')
        .slice(0, 32);

      await this.dataSource.query(
        `INSERT INTO client_error_events
           (app, kind, page_path, error_name, error_message, component_stack,
            api_path, api_status, browser, os, device_kind, fingerprint, visitor_hash, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          dto.app,
          dto.kind,
          pagePath,
          dto.error_name ?? null,
          dto.error_message ?? null,
          dto.component_stack ?? null,
          apiPath,
          dto.api_status ?? null,
          ua.browser,
          ua.os,
          ua.deviceKind,
          fingerprint,
          this.visitorHash(ctx.ip, ctx.userAgent),
          ctx.userId,
        ],
      );
    } catch (err) {
      // نفس قاعدة المشروع: فشل تخزين/بنية تحتية بيتسجّل ومايكسرش العملية (CLAUDE.md §2).
      this.logger.warn(`فشل تخزين خطأ واجهة: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * تمييز الزائر **لليوم ده بس**.
   *
   * مفتاح مشتقّ بـHKDF بلافتة غرض خاصة من سر موجود — مش إعادة استخدام للسر (فصل مجالات)، ومش سر
   * جديد لازم حد يديره في الإنتاج. الملح هو تاريخ اليوم، فالمفتاح بيلف كل يوم: العدد اليومي
   * صحيح، وربط نفس الزائر عبر أيام **مستحيل** — وده الفرق بين قياس وبين بناء ملف عن زائر.
   */
  private visitorHash(ip: string | null, userAgent: string | null): string | null {
    if (!ip && !userAgent) return null;
    const base =
      this.config.get<string>('auth.pinPepper') ||
      this.config.get<string>('jwt.accessSecret') ||
      process.env.JWT_ACCESS_SECRET ||
      '';
    if (!base) return null;
    const day = new Date().toISOString().slice(0, 10);
    const key = Buffer.from(hkdfSync('sha256', base, day, 'baytak/client-telemetry/visitor', 32));
    return createHash('sha256')
      .update(key)
      .update(`${ip ?? ''}|${userAgent ?? ''}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** التجميع اللي الشاشة والإنذار بيقروا منه. */
  async summary(from: Date, to: Date, limit = 50): Promise<ClientErrorSummaryRow[]> {
    return this.dataSource.query<ClientErrorSummaryRow[]>(
      `SELECT fingerprint,
              MIN(app) AS app,
              MIN(kind) AS kind,
              MIN(page_path) AS page_path,
              MIN(error_name) AS error_name,
              MIN(error_message) AS error_message,
              MIN(api_path) AS api_path,
              MIN(api_status)::int AS api_status,
              COUNT(*)::int AS events,
              COUNT(DISTINCT visitor_hash)::int AS visitors,
              MODE() WITHIN GROUP (ORDER BY browser) AS top_browser,
              MODE() WITHIN GROUP (ORDER BY device_kind) AS top_device,
              MIN(occurred_at) AS first_seen,
              MAX(occurred_at) AS last_seen
         FROM client_error_events
        WHERE deleted_at IS NULL AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY fingerprint
        ORDER BY COUNT(DISTINCT visitor_hash) DESC, COUNT(*) DESC
        LIMIT $3`,
      [from, to, Math.min(Math.max(limit, 1), 200)],
    );
  }

  /** العدد في آخر ساعة — الإشارة اللي بتدخل `OpsMetricsService`. */
  async countLastHour(): Promise<{ total: number; visitors: number }> {
    const [row] = await this.dataSource.query<{ total: number; visitors: number }[]>(
      `SELECT COUNT(*)::int AS total, COUNT(DISTINCT visitor_hash)::int AS visitors
         FROM client_error_events
        WHERE deleted_at IS NULL AND occurred_at >= now() - interval '1 hour'`,
    );
    return row ?? { total: 0, visitors: 0 };
  }

  /** تنظيف الاحتفاظ — **حذف نهائي مش soft delete**: صف قديم مالوش أي قيمة تشخيصية. */
  async purge(retentionDays: number): Promise<number> {
    const days = Math.min(Math.max(Math.trunc(retentionDays), 1), 365);
    const result = await this.dataSource.query<unknown[]>(
      `DELETE FROM client_error_events WHERE occurred_at < now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    return Array.isArray(result) ? 0 : Number(result ?? 0);
  }
}

/**
 * **تطهير المسار** — القيم المتغيرة بتتحوّل لرموز ثابتة.
 *
 * سببين: (١) التجميع — من غير كده كل طلب بيبقى صف لوحده فالجدول يبقى سجل مش قياس. (٢) الأمان —
 * مسار ممكن يكون فيه بالغلط رقم تليفون أو توكن في query string، والتطهير هنا **في السيرفر**
 * (مش بس في العميل) عشان مانعتمدش على اللي بيبعت.
 */
export function sanitizePath(raw: string): string {
  const withoutQuery = raw.split('#')[0].split('?')[0];
  return withoutQuery
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':id')
    .replace(/\+?\d{7,}/g, ':num')
    .replace(/\/\d+(?=\/|$)/g, '/:num')
    .slice(0, MAX_PATH);
}

/**
 * **المتصفح/النظام بيتشقّوا هنا مش بيتبعتوا من العميل** — أي حقل جاي من مسار عام بيتعامل كمدخل
 * مش كحقيقة. الـ`user-agent` هيدر بيوصل مع الطلب أصلاً فمفيش حاجة زيادة تتبعت.
 *
 * التصنيف خشن عن قصد (دلاء مش نسخ): السؤال هو «المشكلة على سفاري الموبايل بس؟» مش «إصدار كام».
 */
export function parseUserAgent(ua: string | null): {
  browser: string | null;
  os: string | null;
  deviceKind: string | null;
} {
  if (!ua) return { browser: null, os: null, deviceKind: null };
  const s = ua.slice(0, 400);

  let browser: string | null = 'other';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Safari\//.test(s)) browser = 'Safari';
  else if (/bot|crawl|spider/i.test(s)) browser = 'bot';

  let os: string | null = 'other';
  if (/Android/.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  const deviceKind = /iPad|Tablet/.test(s) ? 'tablet' : /Mobi|Android|iPhone/.test(s) ? 'mobile' : 'desktop';
  return { browser, os, deviceKind };
}
