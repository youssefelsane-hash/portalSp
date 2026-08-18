import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { SettingsService } from '../settings/settings.service';

export enum EmployeePresenceState {
  ACTIVE = 'active',
  IDLE = 'idle',
  OFFLINE = 'offline',
}

export interface EmployeePresence {
  state: EmployeePresenceState;
  last_activity_at: string | null;
  active_sessions_count: number;
}

export interface WorkforceSummaryRow {
  user_id: string;
  full_name: string;
  department: string | null;
  first_login_at: string | null;
  last_activity_at: string | null;
  state: EmployeePresenceState;
  active_seconds_today: number;
  sessions_today: number;
  actions_today: number;
  denied_sensitive_today: number;
  open_alerts: number;
}

const DEFAULT_IDLE_THRESHOLD_SECONDS = 300;

// جلسة الموظف = refresh_tokens (ADR-0016 §1) — صفر جدول "employee_sessions" جديد. الجديد الوحيد
// هنا: heartbeat محسوب (active_seconds تراكمي)، وحالة حية (ACTIVE/IDLE/OFFLINE) مشتقة وقت
// القراءة بدل مخزّنة (ADR-0016 §2 — نفس فلسفة PermissionsGuard الفحص الحي).
@Injectable()
export class WorkforceActivityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly settings: SettingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listSessions(userId: string): Promise<RefreshToken[]> {
    return this.refreshTokens.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 });
  }

  /**
   * Part 6 §16 / Part 24 test #15 — إلغاء جلسة موظف واحدة بعينها (مش bulk زي block/disable
   * الموجودين). نفس نمط AuthService.revokeSession بالحرف، بس بـrevokedReason مختلف يوضّح إن أدمن
   * تاني هو اللي نفّذ العملية (مش الموظف نفسه)، ومسموح لأي actor عنده security.sessions.revoke —
   * مش شرط يكون صاحب الجلسة.
   */
  async revokeEmployeeSession(actorUserId: string, targetUserId: string, sessionId: string): Promise<void> {
    const result = await this.refreshTokens.update(
      { id: sessionId, userId: targetUserId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date(), revokedReason: 'admin_revoked_session' },
    );
    if (!result.affected) {
      throw new ApiException(ErrorCode.VAL_001, 'الجلسة غير موجودة أو ملغاة بالفعل', HttpStatus.NOT_FOUND);
    }
    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'employee.session_revoked',
      entityType: 'user',
      entityId: targetUserId,
      newValues: { session_id: sessionId },
    });
  }

  private async idleThresholdSeconds(): Promise<number> {
    return this.settings.getNumber('workforce.idle_threshold_seconds', DEFAULT_IDLE_THRESHOLD_SECONDS);
  }

  /**
   * بتتنادى من POST /admin/workforce/heartbeat — مرة كل دقيقة بالكتير من apps/admin أثناء التاب
   * نشط بس. خوارزمية وقت العمل الفعلي (ADR-0016 §3): الفجوة من آخر heartbeat بتتضاف لـactive_seconds
   * لو ≤ عتبة الـidle، وإلا بتتجاهل (كانت فترة idle حقيقية — مثال السكريبت بالحرف).
   *
   * ملاحظة معمارية صريحة: الـaccess token (JwtPayload) مبيحملش session/refresh-token id (تصميم
   * موجود من قبل، ADR-0011) — إضافة claim جديد كانت هتلمس إصدار/تحقق التوكن في كل التطبيق. فبدل
   * كده: refresh_tokens.last_activity_at بيتحدّث لكل جلسات المستخدم النشطة (عادة جلسة واحدة أو
   * اتنين) بدل جلسة واحدة بعينها — تقريب معقول (لو فاتح جهازين، الاتنين على الأرجح نشطين قريب من
   * بعض)، مش دقة مثالية لكل جلسة على حدة. مصدر الحقيقة الفعلي لحالة ACTIVE/IDLE/وقت العمل هو
   * employee_daily_activity (على مستوى المستخدم، مش الجلسة) — ده مظبوط 100%.
   */
  async heartbeat(userId: string): Promise<void> {
    const idleThreshold = await this.idleThresholdSeconds();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    await this.refreshTokens.update({ userId, isRevoked: false }, { lastActivityAt: now });

    const existing = await this.dataSource.query<{ last_activity_at: string | null; activity_date: string }[]>(
      `SELECT last_activity_at, activity_date::text FROM employee_daily_activity WHERE user_id = $1 AND activity_date = $2`,
      [userId, today],
    );

    if (existing.length === 0) {
      await this.dataSource.query(
        `INSERT INTO employee_daily_activity (user_id, activity_date, last_activity_at, active_seconds)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, activity_date) DO UPDATE SET last_activity_at = $3, updated_at = now()`,
        [userId, today, now],
      );
      return;
    }

    const lastActivityAt = existing[0].last_activity_at ? new Date(existing[0].last_activity_at) : null;
    const gapSeconds = lastActivityAt ? Math.max(0, (now.getTime() - lastActivityAt.getTime()) / 1000) : 0;
    const contributesActive = lastActivityAt !== null && gapSeconds <= idleThreshold;

    await this.dataSource.query(
      `UPDATE employee_daily_activity
       SET last_activity_at = $3,
           active_seconds = active_seconds + $4,
           updated_at = now()
       WHERE user_id = $1 AND activity_date = $2`,
      [userId, today, now, contributesActive ? Math.round(gapSeconds) : 0],
    );
  }

  /** بتتنادى وقت تسجيل الدخول الناجح — بتزوّد sessions_count وتسجّل first/last_login_at. */
  async recordLogin(userId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    await this.dataSource.query(
      `INSERT INTO employee_daily_activity (user_id, activity_date, first_login_at, last_login_at, sessions_count)
       VALUES ($1, $2, $3, $3, 1)
       ON CONFLICT (user_id, activity_date)
       DO UPDATE SET last_login_at = $3, sessions_count = employee_daily_activity.sessions_count + 1, updated_at = now()`,
      [userId, today, now],
    );
  }

  /** بتتنادى وقت تسجيل فعل حساس (audit-logged) — actions_count لملخص القوى العاملة. */
  async recordAction(userId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.dataSource.query(
      `INSERT INTO employee_daily_activity (user_id, activity_date, actions_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, activity_date)
       DO UPDATE SET actions_count = employee_daily_activity.actions_count + 1, updated_at = now()`,
      [userId, today],
    );
  }

  async getPresence(userId: string): Promise<EmployeePresence> {
    const idleThreshold = await this.idleThresholdSeconds();
    const activeSessions = await this.refreshTokens.count({
      where: { userId, isRevoked: false },
    });
    if (activeSessions === 0) {
      return { state: EmployeePresenceState.OFFLINE, last_activity_at: null, active_sessions_count: 0 };
    }
    const [row] = await this.dataSource.query<{ last_activity_at: string | null }[]>(
      `SELECT last_activity_at FROM employee_daily_activity WHERE user_id = $1 AND activity_date = CURRENT_DATE`,
      [userId],
    );
    const lastActivityAt = row?.last_activity_at ? new Date(row.last_activity_at) : null;
    if (!lastActivityAt) {
      return { state: EmployeePresenceState.IDLE, last_activity_at: null, active_sessions_count: activeSessions };
    }
    const secondsSince = (Date.now() - lastActivityAt.getTime()) / 1000;
    const state = secondsSince <= idleThreshold ? EmployeePresenceState.ACTIVE : EmployeePresenceState.IDLE;
    return { state, last_activity_at: lastActivityAt.toISOString(), active_sessions_count: activeSessions };
  }

  /** بتتنادى وقت logout صريح (AuthService.revokeSession/revokeAllUserTokens) — تسجيل الوقت بس. */
  async recordLogout(userId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.dataSource.query(
      `UPDATE employee_daily_activity SET last_logout_at = now(), updated_at = now()
       WHERE user_id = $1 AND activity_date = $2`,
      [userId, today],
    );
  }

  /**
   * ملخص القوى العاملة (Part 2 §5) — استعلام واحد محدود بموظفين الأدمن بس (join مع employee_profiles)،
   * bounded (Part 21) — صف واحد لكل موظف لليوم الحالي، مش سكان لأي جدول تاريخي كبير.
   */
  async getWorkforceSummary(): Promise<WorkforceSummaryRow[]> {
    const idleThreshold = await this.idleThresholdSeconds();
    const rows = await this.dataSource.query<
      {
        user_id: string;
        full_name: string;
        department: string | null;
        first_login_at: string | null;
        last_activity_at: string | null;
        active_seconds_today: number;
        sessions_today: number;
        actions_today: number;
        denied_sensitive_today: number;
        active_sessions_count: string;
        open_alerts: string;
      }[]
    >(
      `SELECT
         u.id AS user_id, u.full_name, ep.department,
         eda.first_login_at, eda.last_activity_at,
         COALESCE(eda.active_seconds, 0) AS active_seconds_today,
         COALESCE(eda.sessions_count, 0) AS sessions_today,
         COALESCE(eda.actions_count, 0) AS actions_today,
         COALESCE(eda.denied_sensitive_count, 0) AS denied_sensitive_today,
         (SELECT count(*) FROM refresh_tokens rt WHERE rt.user_id = u.id AND rt.is_revoked = false) AS active_sessions_count,
         (SELECT count(*) FROM security_events se WHERE se.target_user_id = u.id AND se.status = 'open') AS open_alerts
       FROM users u
       JOIN employee_profiles ep ON ep.user_id = u.id
       LEFT JOIN employee_daily_activity eda ON eda.user_id = u.id AND eda.activity_date = CURRENT_DATE
       WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
       ORDER BY u.full_name ASC`,
    );

    return rows.map((r) => {
      const activeSessions = Number(r.active_sessions_count);
      let state = EmployeePresenceState.OFFLINE;
      if (activeSessions > 0) {
        const lastActivityAt = r.last_activity_at ? new Date(r.last_activity_at) : null;
        state =
          lastActivityAt && (Date.now() - lastActivityAt.getTime()) / 1000 <= idleThreshold
            ? EmployeePresenceState.ACTIVE
            : EmployeePresenceState.IDLE;
      }
      return {
        user_id: r.user_id,
        full_name: r.full_name,
        department: r.department,
        first_login_at: r.first_login_at,
        last_activity_at: r.last_activity_at,
        state,
        active_seconds_today: Number(r.active_seconds_today),
        sessions_today: Number(r.sessions_today),
        actions_today: Number(r.actions_today),
        denied_sensitive_today: Number(r.denied_sensitive_today),
        open_alerts: Number(r.open_alerts),
      };
    });
  }
}
