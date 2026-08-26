import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtPayload } from '../../modules/auth/types/authenticated-request';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { websocketCorsOriginHandler } from './websocket-cors.util';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeSessionRegistry } from './realtime-session-registry.service';
import { ADMIN_TOPICS, AdminLiveEvent, AdminTopic, TOPIC_PERMISSIONS } from './admin-topics';

// ── أحداث الدومين المستوردة (نفس المصادر اللي بتتولد أصلاً من العمليات الحقيقية) ──
import {
  ORDER_CREATED_EVENT,
  OrderCreatedEvent,
} from '../../common/events/order-created.event';
import {
  ORDER_STATUS_CHANGED_EVENT,
  OrderStatusChangedEvent,
} from '../../common/events/order-status-changed.event';
import {
  ORDER_REMATCH_REQUESTED_EVENT,
  OrderRematchRequestedEvent,
} from '../../common/events/order-rematch-requested.event';
import {
  ORDER_RESCHEDULED_EVENT,
  OrderRescheduledEvent,
} from '../../common/events/order-rescheduled.event';
import {
  TECHNICIAN_ORDER_CANCELLED_EVENT,
  TechnicianOrderCancelledEvent,
} from '../../common/events/technician-order-cancelled.event';
import {
  ORDER_CREW_CHANGED_EVENT,
  OrderCrewChangedEvent,
} from '../../common/events/order-crew-changed.event';
import {
  ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT,
  OrderAssistantAssignedManuallyEvent,
} from '../../common/events/order-assistant-assigned-manually.event';
import {
  ORDER_NO_TECHNICIAN_FOUND_EVENT,
  OrderNoTechnicianFoundEvent,
} from '../../common/events/order-no-technician-found.event';
import {
  ORDER_CREW_SHORTAGE_ESCALATED_EVENT,
  OrderCrewShortageEscalatedEvent,
} from '../../common/events/order-crew-shortage-escalated.event';
import {
  CASH_COLLECTED_EVENT,
  CashCollectedEvent,
} from '../../common/events/cash-collected.event';
import {
  ADDITIONAL_WORK_PAYMENT_RESOLVED_EVENT,
  AdditionalWorkPaymentResolvedEvent,
} from '../../common/events/additional-work-payment.event';
import {
  PAYMENT_INSTAPAY_CONFIRMED_EVENT,
  PaymentInstaPayConfirmedEvent,
} from '../../common/events/payment-instapay-confirmed.event';
import {
  PAYMENT_INSTAPAY_REJECTED_EVENT,
  PaymentInstaPayRejectedEvent,
} from '../../common/events/payment-instapay-rejected.event';
import {
  PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT,
  PaymentInstaPayTransferReportedEvent,
} from '../../common/events/payment-instapay-transfer-reported.event';
import {
  PAYOUT_COMPLETED_EVENT,
  PayoutCompletedEvent,
} from '../../common/events/payout-completed.event';
import {
  PAYOUT_REQUIRES_REVIEW_EVENT,
  PayoutRequiresReviewEvent,
} from '../../common/events/payout-requires-review.event';
import {
  COMPLAINT_FILED_EVENT,
  ComplaintFiledEvent,
} from '../../common/events/complaint-filed.event';
import {
  SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT,
  SupportChatMessageReceivedEvent,
} from '../../common/events/support-chat-message-received.event';
import {
  RATING_SUBMITTED_EVENT,
  RatingSubmittedEvent,
} from '../../common/events/rating-submitted.event';
import {
  LOW_RATING_SUBMITTED_EVENT,
  LowRatingSubmittedEvent,
} from '../../common/events/low-rating-submitted.event';
import {
  SETTING_UPDATED_EVENT,
  SettingUpdatedEvent,
} from '../../common/events/setting-updated.event';
import {
  SECURITY_EVENT_CREATED_EVENT,
  SecurityEventCreatedEvent,
} from '../../common/events/security-event-created.event';
import {
  RECURRING_TEMPLATE_GENERATION_FAILING_EVENT,
  RecurringTemplateGenerationFailingEvent,
} from '../../common/events/recurring-template-generation-failing.event';
import {
  RECURRING_ORDER_AWAITING_PAYMENT_EVENT,
  RecurringOrderAwaitingPaymentEvent,
} from '../../common/events/recurring-order-awaiting-payment.event';
import {
  INSTALLMENT_APPLICATION_SUBMITTED_EVENT,
  INSTALLMENTS_APPLICATION_REVIEWED_EVENT,
  INSTALLMENT_PAYMENT_FAILED_EVENT,
  INSTALLMENT_PAYMENT_SUCCEEDED_EVENT,
  INSTALLMENTS_PLAN_COMPLETED_EVENT,
} from '../../common/events/installment.events';
import {
  InstallmentApplicationReviewedEvent,
  InstallmentApplicationSubmittedEvent,
} from '../../common/events/installment.events';
import type { InstallmentPaymentResolvedPayload } from '../../common/events/installment.events';
import { WORK_OPPORTUNITY_OFFERED_EVENT, WorkOpportunityOfferedEvent } from '../../common/events/work-opportunity-offered.event';
import { TECHNICIAN_VERIFICATION_CHANGED_EVENT, TechnicianVerificationChangedEvent } from '../../common/events/technician-verification-changed.event';
import { TECHNICIAN_SERVICE_VERIFICATION_CHANGED_EVENT, TechnicianServiceVerificationChangedEvent } from '../../common/events/technician-service-verification-changed.event';
import { TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT, TechnicianCategoryVerificationChangedEvent } from '../../common/events/technician-category-verification-changed.event';
import {
  TECHNICIAN_PRESENCE_CHANGED_EVENT,
  TechnicianPresenceChangedEvent,
} from '../events/technician-presence-changed.event';
import {
  PROJECT_CHANGED_EVENT,
  ProjectChangedEvent,
} from '../events/project-changed.event';
import {
  WARRANTY_CLAIM_CHANGED_EVENT,
  WarrantyClaimChangedEvent,
} from '../events/warranty-claim-changed.event';

interface AuthenticatedSocket extends Socket {
  data: { user?: JwtPayload; authentication?: Promise<JwtPayload>; topics?: Set<AdminTopic> };
}

const room = (topic: AdminTopic): string => `admin:topic:${topic}`;
const userRoom = (userId: string): string => `admin:user:${userId}`;

/**
 * بث حي لشاشات الأدمن (namespace /admin) — امتداد مباشر لنفس بنية /tracking و/chat:
 * نفس handshake auth (JWT عبر RealtimeAccessService)، نفس سجل الجلسات مع الإبطال اللحظي
 * (pg_notify)، ونفس نمط @OnEvent على أحداث الدومين الموجودة أصلًا — صفر نظام موازٍ.
 *
 * الأمان:
 * - handshake يرفض أي حساب غير admin.
 * - الاشتراك في topic بيتم بعد فحص الصلاحية المطلوبة حيًا من قاعدة البيانات
 *   (TOPIC_PERMISSIONS) — فسحب الصلاحية يمنع الأحداث الجديدة من الاشتراك القادم.
 * - الإبطال اللحظي (RealtimeSessionRegistry + pg_notify) بيفصل سوكِت الأدمن فورًا.
 *
 * مصدر الحقيقة: الأحداث دي **إشعارات UI فقط** — الشاشة بتحدّث نفسها بإعادة جلب صامتة من
 * نفس endpoints الـREST، فمفيش أي حالة أعمال تعيش في طبقة السوكِت.
 */
@WebSocketGateway({ namespace: 'admin', cors: { origin: websocketCorsOriginHandler } })
export class AdminRealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminRealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly realtimeAccess: RealtimeAccessService,
    private readonly sessions: RealtimeSessionRegistry,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    client.data.authentication = this.realtimeAccess.authenticate(client.handshake.auth?.token).then((payload) => {
      if (payload.userType !== 'admin') {
        throw new Error('non-admin');
      }
      client.data.user = payload;
      this.sessions.register(payload.sub, client);
      return payload;
    });
    try {
      const payload = await client.data.authentication;
      client.join(userRoom(payload.sub));
      if (process.env.DEBUG_RT) console.log('[DEBUG RT] connected+joined', payload.sub);
      client.emit('admin:connected', { at: new Date().toISOString() });
    } catch {
      client.emit('error', { code: 'AUTH_001', message: 'توكن غير صالح أو الحساب مش أدمن' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.sessions.unregister(client.data.user?.sub, client);
    this.logger.debug(`admin disconnected: ${client.id}`);
  }

  /** فحص حية من قاعدة البيانات — نفس مسار PermissionsGuard. */
  private async topicAllowed(userId: string, topic: AdminTopic): Promise<boolean> {
    const required = TOPIC_PERMISSIONS[topic];
    if (required === null) return true;
    // نفس شكل استعلام getUserPermissionNames (super_admin يتخطى بالكامل) بدون استيراد
    // AdminModule — تفادي الدورة الموثقة في admin.module.ts.
    const [isSuper] = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS(
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.name = 'super_admin'
         WHERE ur.user_id = $1
       ) AS exists`,
      [userId],
    );
    if (isSuper?.exists) return true;
    const rows = await this.dataSource.query<{ name: string; }[]>(
      `SELECT DISTINCT p.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.is_active = true
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1`,
      [userId],
    );
    return new Set(rows.map((row: { name: string }) => row.name)).has(required);
  }

  @SubscribeMessage('admin:subscribe')
  async handleSubscribe(client: AuthenticatedSocket): Promise<unknown> {
    if (process.env.DEBUG_RT) console.log('[DEBUG RT] subscribe called');
    const payload = await this.activePayload(client);
    if (process.env.DEBUG_RT) console.log('[DEBUG RT] subscribe payload:', payload?.sub ?? null);
    if (!payload) {
      // ack-based: العميل بيستخدم emitWithAck — رجّع الداتا مباشرة بدون مفتاح event
    // (شكل {event,data} كان هيبعت حدث مسمّى بدل ما يملأ الـack فعلًا).
    return { topics: [...ADMIN_TOPICS], denied: [...ADMIN_TOPICS] };
    }
    client.data.topics = new Set();
    const granted: AdminTopic[] = [];
    const denied: AdminTopic[] = [];
    for (const topic of ADMIN_TOPICS) {
      // super_admin بيتخطى الفحص عن طريق getUserPermissionNames زي باقي النظام بالظبط.
      if (await this.topicAllowed(payload.sub, topic)) {
        client.join(room(topic));
        client.data.topics.add(topic);
        granted.push(topic);
      } else {
        denied.push(topic);
      }
    }
    return { topics: granted, denied };
  }

  private async activePayload(client: AuthenticatedSocket): Promise<JwtPayload | null> {
    const payload = client.data.user ?? (await client.data.authentication?.catch(() => undefined));
    if (!payload || payload.userType !== 'admin') return null;
    try {
      await this.realtimeAccess.assertActive(payload);
      return payload;
    } catch {
      this.sessions.disconnectUser(payload.sub, 'الحساب أو الجلسة غير متاحة');
      return null;
    }
  }

  /** نقطة البث الوحيدة — كل الـhandlers بتستدعيها. الفشل هنا مابيكسرش العملية الأصلية. */
  private emitTopic(topic: AdminTopic, event: Omit<AdminLiveEvent, 'topic' | 'at'> & Partial<Pick<AdminLiveEvent, 'at'>>): void {
    const payload: AdminLiveEvent = { ...event, topic, at: event.at ?? new Date().toISOString() };
    this.server.to(room(topic)).emit('admin:live', payload);
  }

  // ── orders ──────────────────────────────────────────────────────────────

  @OnEvent(ORDER_CREATED_EVENT)
  onOrderCreated(event: OrderCreatedEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'created', entity_id: event.orderId });
  }

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  onOrderStatusChanged(event: OrderStatusChangedEvent): void {
    this.emitTopic('orders', {
      entity: 'order',
      action: 'status_changed',
      entity_id: event.orderId,
      data: { order_number: event.orderNumber, previous_status: event.previousStatus, new_status: event.newStatus },
    });
  }

  @OnEvent(ORDER_REMATCH_REQUESTED_EVENT)
  onRematch(event: OrderRematchRequestedEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'rematch_requested', entity_id: event.orderId });
  }

  @OnEvent(ORDER_RESCHEDULED_EVENT)
  onRescheduled(event: OrderRescheduledEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'rescheduled', entity_id: event.orderId });
  }

  @OnEvent(TECHNICIAN_ORDER_CANCELLED_EVENT)
  onTechCancelled(event: TechnicianOrderCancelledEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'technician_cancelled', entity_id: event.orderId });
  }

  @OnEvent(ORDER_CREW_CHANGED_EVENT)
  onCrewChanged(event: OrderCrewChangedEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'crew_changed', entity_id: event.orderId });
  }

  @OnEvent(ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT)
  onAssistantAssigned(event: OrderAssistantAssignedManuallyEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'assistant_assigned', entity_id: event.orderId });
  }

  @OnEvent(ORDER_NO_TECHNICIAN_FOUND_EVENT)
  onNoTechnicianFound(event: OrderNoTechnicianFoundEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'no_technician_found', entity_id: event.orderId });
  }

  @OnEvent(ORDER_CREW_SHORTAGE_ESCALATED_EVENT)
  onCrewShortageEscalated(event: OrderCrewShortageEscalatedEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'crew_shortage_escalated', entity_id: event.orderId });
  }

  // ── technicians ────────────────────────────────────────────────────────

  @OnEvent(TECHNICIAN_VERIFICATION_CHANGED_EVENT)
  onVerificationChanged(event: TechnicianVerificationChangedEvent): void {
    this.emitTopic('technicians', { entity: 'technician', action: 'verification_changed', entity_id: event.technicianProfileId });
  }

  @OnEvent(TECHNICIAN_SERVICE_VERIFICATION_CHANGED_EVENT)
  onServiceVerificationChanged(): void {
    this.emitTopic('technicians', { entity: 'technician', action: 'service_verification_changed', entity_id: null });
  }

  @OnEvent(TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT)
  onCategoryVerificationChanged(): void {
    this.emitTopic('technicians', { entity: 'technician', action: 'category_verification_changed', entity_id: null });
  }

  @OnEvent(TECHNICIAN_PRESENCE_CHANGED_EVENT)
  onTechnicianPresenceChanged(event: TechnicianPresenceChangedEvent): void {
    this.emitTopic('technicians', {
      entity: 'technician',
      action: 'presence_changed',
      entity_id: event.userId,
      data: { online: event.online },
    });
  }

  @OnEvent(WORK_OPPORTUNITY_OFFERED_EVENT)
  onWorkOpportunityOffered(event: WorkOpportunityOfferedEvent): void {
    this.emitTopic('orders', { entity: 'order', action: 'work_opportunity_offered', entity_id: event.orderId });
  }

  // ── projects / warranty ─────────────────────────────────────────────────

  @OnEvent(PROJECT_CHANGED_EVENT)
  onProjectChanged(event: ProjectChangedEvent): void {
    this.emitTopic('projects', {
      entity: 'project',
      action: event.action,
      entity_id: event.projectId,
    });
  }

  @OnEvent(WARRANTY_CLAIM_CHANGED_EVENT)
  onWarrantyClaimChanged(event: WarrantyClaimChangedEvent): void {
    this.emitTopic('warranty', {
      entity: 'warranty_claim',
      action: event.action,
      entity_id: event.claimId,
    });
  }

  // ── payments / payouts / refunds-adjacent ──────────────────────────────

  @OnEvent(CASH_COLLECTED_EVENT)
  onCashCollected(event: CashCollectedEvent): void {
    this.emitTopic('payments', { entity: 'payment', action: 'cash_collected', entity_id: event.orderId, data: { orderId: event.orderId } });
  }

  @OnEvent(ADDITIONAL_WORK_PAYMENT_RESOLVED_EVENT)
  onAdditionalWorkResolved(event: AdditionalWorkPaymentResolvedEvent): void {
    this.emitTopic('payments', {
      entity: 'payment',
      action: event.succeeded ? 'succeeded' : 'failed',
      entity_id: event.paymentId,
      data: { orderId: event.orderId },
    });
  }

  @OnEvent(PAYMENT_INSTAPAY_CONFIRMED_EVENT)
  onInstapayConfirmed(event: PaymentInstaPayConfirmedEvent): void {
    this.emitTopic('payments', { entity: 'payment', action: 'instapay_confirmed', entity_id: event.orderId ?? null });
  }

  @OnEvent(PAYMENT_INSTAPAY_REJECTED_EVENT)
  onInstapayRejected(event: PaymentInstaPayRejectedEvent): void {
    this.emitTopic('payments', { entity: 'payment', action: 'instapay_rejected', entity_id: event.orderId ?? null });
  }

  @OnEvent(PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT)
  onInstapayReported(event: PaymentInstaPayTransferReportedEvent): void {
    this.emitTopic('payments', { entity: 'payment', action: 'instapay_reported', entity_id: event.orderId ?? null });
  }

  @OnEvent(PAYOUT_COMPLETED_EVENT)
  onPayoutCompleted(event: PayoutCompletedEvent): void {
    this.emitTopic('payouts', { entity: 'payout', action: 'completed', entity_id: event.payoutId });
  }

  @OnEvent(PAYOUT_REQUIRES_REVIEW_EVENT)
  onPayoutRequiresReview(event: PayoutRequiresReviewEvent): void {
    this.emitTopic('payouts', { entity: 'payout', action: 'requires_review', entity_id: event.payoutId });
  }

  // ── installments (migration 0177) ───────────────────────────────────────

  @OnEvent(INSTALLMENT_APPLICATION_SUBMITTED_EVENT)
  onInstallmentSubmitted(event: InstallmentApplicationSubmittedEvent): void {
    this.emitTopic('installments', { entity: 'installment_application', action: 'submitted', entity_id: event.applicationId });
  }

  @OnEvent(INSTALLMENTS_APPLICATION_REVIEWED_EVENT)
  onInstallmentReviewed(event: InstallmentApplicationReviewedEvent): void {
    this.emitTopic('installments', {
      entity: 'installment_application',
      action: event.approved ? 'approved' : 'rejected',
      entity_id: event.applicationId,
    });
  }

  @OnEvent(INSTALLMENT_PAYMENT_SUCCEEDED_EVENT)
  onInstallmentPaymentSucceeded(payload: InstallmentPaymentResolvedPayload): void {
    this.emitTopic('installments', {
      entity: 'installment_payment',
      action: 'payment_succeeded',
      entity_id: payload.installmentId,
      data: { application_id: payload.applicationId },
    });
  }

  @OnEvent(INSTALLMENT_PAYMENT_FAILED_EVENT)
  onInstallmentPaymentFailed(payload: InstallmentPaymentResolvedPayload): void {
    this.emitTopic('installments', {
      entity: 'installment_payment',
      action: 'payment_failed',
      entity_id: payload.installmentId,
      data: { application_id: payload.applicationId },
    });
  }

  @OnEvent(INSTALLMENTS_PLAN_COMPLETED_EVENT)
  onPlanCompleted(payload: { applicationId: string }): void {
    this.emitTopic('installments', { entity: 'installment_application', action: 'plan_completed', entity_id: payload.applicationId });
  }

  // ── recurring ───────────────────────────────────────────────────────────

  @OnEvent(RECURRING_ORDER_AWAITING_PAYMENT_EVENT)
  onRecurringAwaitingPayment(event: RecurringOrderAwaitingPaymentEvent): void {
    this.emitTopic('recurring', { entity: 'recurring_template', action: 'awaiting_payment', entity_id: event.orderId });
  }

  @OnEvent(RECURRING_TEMPLATE_GENERATION_FAILING_EVENT)
  onRecurringFailing(event: RecurringTemplateGenerationFailingEvent): void {
    this.emitTopic('recurring', { entity: 'recurring_template', action: 'generation_failing', entity_id: event.templateId });
  }

  // ── support / complaints / ratings ──────────────────────────────────────

  @OnEvent(COMPLAINT_FILED_EVENT)
  onComplaintFiled(event: ComplaintFiledEvent): void {
    this.emitTopic('support', { entity: 'complaint', action: 'filed', entity_id: event.complaintId, data: { complaint_number: event.complaintNumber } });
  }

  @OnEvent(SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT)
  onSupportMessage(event: SupportChatMessageReceivedEvent): void {
    this.emitTopic('support', { entity: 'support_message', action: 'received', entity_id: event.threadId ?? null });
  }

  @OnEvent(RATING_SUBMITTED_EVENT)
  onRatingSubmitted(event: RatingSubmittedEvent): void {
    this.emitTopic('ratings', { entity: 'rating', action: 'submitted', entity_id: event.ratingId });
  }

  @OnEvent(LOW_RATING_SUBMITTED_EVENT)
  onLowRating(event: LowRatingSubmittedEvent): void {
    this.emitTopic('ratings', { entity: 'rating', action: 'low_rating', entity_id: event.ratingId });
  }

  // ── settings / security ─────────────────────────────────────────────────

  @OnEvent(SETTING_UPDATED_EVENT)
  onSettingUpdated(event: SettingUpdatedEvent): void {
    this.emitTopic('settings', { entity: 'setting', action: 'updated', entity_id: event.key });
  }

  @OnEvent(SECURITY_EVENT_CREATED_EVENT)
  onSecurityEvent(event: SecurityEventCreatedEvent): void {
    this.emitTopic('security', { entity: 'security_event', action: 'created', entity_id: event.securityEventId });
  }
}
