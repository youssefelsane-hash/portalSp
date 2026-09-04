# 18 — خريطة الـAPI (API Map)

> **مُستخرَج آليًا من الـcontrollers** — 591 مسارًا فريدًا (مسار × فعل) عبر كل
> `*.controller.ts` في `apps/api`.
>
> مستندات مرتبطة: [20 — الأمان والصلاحيات](./20-SECURITY-PERMISSIONS.md) ·
> `docs/02-data-dictionary.md` (عقد الـAPI التفصيلي)

---

## 1. الاتفاقيات

| البند | القاعدة |
|-------|---------|
| البادئة | `/api/v1` (مضافة عالميًا) |
| المسارات | `kebab-case` |
| الأخطاء | `ApiException` بـ`ErrorCode` (`VAL_001`, `AUTH_001`, `ORDR_003`, …) + رسالة عربية |
| المصادقة | JWT في `Authorization: Bearer`، و`@Public()` للاستثناء |
| القناة | `X-Client-Channel` — **`call_center` مرفوض من العميل** (منع تزوير مصدر الطلب) |
| التأكيد المرتفع | `X-Step-Up-Token` — صالح دقيقتين، يُستهلَك مرة واحدة |

### قراءة أعمدة الجداول تحت

| العمود | المعنى |
|--------|--------|
| **الصلاحية** | `@RequirePermission('...')` — «—» يعني الدور وحده كافٍ |
| **Step-Up** | «نعم» = محتاج تأكيد Passkey حديث فوق تسجيل الدخول |
| **عام** | «عام» = `@Public()`، بلا مصادقة |

> ⚠️ **حدود الاستخراج**: الأعمدة مبنية على تحليل نصّي للديكوريتورات المجاورة. الحُرّاس
> الفعليون هم مصدر الحقيقة — راجع [20](./20-SECURITY-PERMISSIONS.md) لآلية عملهم، و
> `auth-guards.spec.ts` للسلوك المضمون.

---

## 2. توزيع السطح

| المجموعة | عدد المسارات |
|---|---|
| `/auth` — المصادقة | 20 |
| `/me` — الحساب الشخصي | 25 |
| `/services` — الكتالوج العام | 12 |
| `/orders` — الطلبات (العميل) | 32 |
| `/addresses` — العناوين | 4 |
| `/payment-methods` — وسائل الدفع | 3 |
| `/customer` — العميل | 3 |
| `/complaints` — الشكاوى | 7 |
| `/support-tickets` — تذاكر الدعم | 4 |
| `/chat` — المحادثات | 5 |
| `/notifications` — الإشعارات | 4 |
| `/loyalty` — الولاء | 3 |
| `/technician` — الفني | 94 |
| `/internal-chat` — المحادثات الداخلية | 5 |
| `/admin` — الإدارة | 340 |
| `/academy` — academy | 2 |
| `/booking-policy` — booking-policy | 1 |
| `/branding` — branding | 1 |
| `/cancellation-reasons` — cancellation-reasons | 1 |
| `/checkout` — checkout | 1 |
| `/cities` — cities | 2 |
| `/devices` — devices | 2 |
| `/feature-flags` — feature-flags | 1 |
| `/health` — health | 1 |
| `/installment-applications` — installment-applications | 2 |
| `/installment-plans` — installment-plans | 1 |
| `/legal-entity` — legal-entity | 1 |
| `/payment-channels` — payment-channels | 1 |
| `/promo-codes` — promo-codes | 1 |
| `/service-categories` — service-categories | 2 |
| `/settings` — settings | 2 |
| `/technician-companies` — technician-companies | 1 |
| `/technicians` — technicians | 2 |
| `/trust-info` — trust-info | 1 |
| `/wallet` — wallet | 2 |
| `/webhooks` — webhooks | 2 |


---

## 3. ملاحظات على السطح

**`/admin` = ٥٧٪ من الـAPI** (340 من 591). المنصّة أداة تشغيل قبل ما تكون تطبيق عميل —
معظم التعقيد في التحكّم الإداري مش في مسار الحجز.

**`/technician` (94) أكبر بكتير من `/orders` (32)** — الفني عنده سطح تشغيلي أوسع من العميل:
الجدولة، الفرص، الأرباح، الطاقم، التنفيذ، المستندات.

**البوّابة الحقيقية للحجز ضيّقة عمدًا**: `POST /orders` و`POST /orders/preview` و
`POST /orders/match-preview`. كل التعقيد (التسعير، المطابقة، الجدولة) خلف التلاتة دول.

---


---

## 4. تجديد هذا المستند

```bash
cd apps/api
python3 - <<'EOF'
import re, os, glob
for f in glob.glob('src/**/*.controller.ts', recursive=True):
    src = open(f, encoding='utf-8').read()
    m = re.search(r"@Controller\(\s*'([^']*)'", src)
    base = m.group(1) if m else ''
    for mm in re.finditer(r"@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)", src):
        path = ('/' + base + '/' + (mm.group(2) or '')).replace('//', '/').rstrip('/')
        print(mm.group(1).upper(), path or '/')
EOF
```

---


---

## 5. الكتالوج الكامل

### `/auth` — المصادقة (20 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/auth/logout` | POST | — | — | عام |
| `/auth/me` | DELETE | — | — | عام |
| `/auth/me` | GET | — | — | عام |
| `/auth/me` | PATCH | — | — | عام |
| `/auth/otp/request` | POST | — | — | عام |
| `/auth/otp/verify` | POST | — | — | عام |
| `/auth/recovery/verify` | POST | — | — | عام |
| `/auth/refresh` | POST | — | — | عام |
| `/auth/register` | POST | — | — | عام |
| `/auth/sessions` | GET | — | — | — |
| `/auth/sessions/:id` | DELETE | — | نعم | — |
| `/auth/sessions/revoke-all` | POST | — | نعم | — |
| `/auth/webauthn/authentication/options` | POST | — | — | عام |
| `/auth/webauthn/authentication/verify` | POST | — | — | عام |
| `/auth/webauthn/credentials` | GET | — | — | — |
| `/auth/webauthn/credentials/:id` | DELETE | — | نعم | — |
| `/auth/webauthn/registration/options` | POST | — | — | عام |
| `/auth/webauthn/registration/verify` | POST | — | — | عام |
| `/auth/webauthn/step-up/options` | POST | — | — | — |
| `/auth/webauthn/step-up/verify` | POST | — | — | — |

### `/me` — الحساب الشخصي (25 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/me/favorites/technicians` | GET | — | — | — |
| `/me/favorites/technicians/:technicianId` | DELETE | — | — | — |
| `/me/favorites/technicians/:technicianId` | POST | — | — | — |
| `/me/favorites/technicians/:technicianId/status` | GET | — | — | — |
| `/me/installments` | GET | — | — | — |
| `/me/notification-preferences` | GET | — | — | — |
| `/me/notification-preferences/:channel` | PATCH | — | — | — |
| `/me/projects` | GET | — | — | — |
| `/me/projects` | POST | — | — | — |
| `/me/projects/:id` | GET | — | — | — |
| `/me/projects/:id/comments` | POST | — | — | — |
| `/me/projects/:id/milestones/:milestoneId/approve` | POST | — | — | — |
| `/me/projects/:id/milestones/:milestoneId/reject` | POST | — | — | — |
| `/me/projects/:id/quotes` | GET | — | — | — |
| `/me/projects/:id/quotes/:quoteId/approve` | POST | — | — | — |
| `/me/projects/:id/room` | GET | — | — | — |
| `/me/recurring-orders` | GET | — | — | — |
| `/me/recurring-orders` | POST | — | — | — |
| `/me/recurring-orders/:id` | DELETE | — | — | — |
| `/me/recurring-orders/:id` | PATCH | — | — | — |
| `/me/referrals` | GET | — | — | — |
| `/me/technician-referral` | POST | — | — | — |
| `/me/warranties` | GET | — | — | — |
| `/me/warranties/:warrantyId/claims` | POST | — | — | — |
| `/me/warranties/claims` | GET | — | — | — |

### `/services` — الكتالوج العام (12 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/services` | GET | — | — | عام |
| `/services/:id` | GET | — | — | عام |
| `/services/:id/addons` | GET | — | — | عام |
| `/services/:id/estimate` | POST | — | — | عام |
| `/services/:id/estimate-duration` | POST | — | — | عام |
| `/services/:id/evaluate-price` | POST | — | — | عام |
| `/services/:id/pricing-fields` | GET | — | — | عام |
| `/services/:id/standard-data` | GET | — | — | عام |
| `/services/:id/technicians` | GET | — | — | عام |
| `/services/:serviceId/warranty-plans` | GET | — | — | — |
| `/services/most-requested` | GET | — | — | عام |
| `/services/search` | GET | — | — | عام |

### `/orders` — الطلبات (العميل) (32 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/orders` | GET | — | — | — |
| `/orders` | POST | — | — | — |
| `/orders/:id` | GET | — | — | — |
| `/orders/:id/approve-initial-quote` | POST | — | — | — |
| `/orders/:id/cancel` | POST | — | — | — |
| `/orders/:id/confirm-cash-handover` | POST | — | — | — |
| `/orders/:id/confirm-instapay-transfer` | POST | — | — | — |
| `/orders/:id/current-quote` | GET | — | — | — |
| `/orders/:id/media` | GET | — | — | — |
| `/orders/:id/pay-with-card` | POST | — | — | — |
| `/orders/:id/pay-with-fawry-reference` | POST | — | — | — |
| `/orders/:id/pay-with-instapay` | POST | — | — | — |
| `/orders/:id/pay-with-wallet` | POST | — | — | — |
| `/orders/:id/provider-candidates` | GET | — | — | — |
| `/orders/:id/quote-items` | GET | — | — | — |
| `/orders/:id/quote-items/approve` | POST | — | — | — |
| `/orders/:id/quote-items/decline` | POST | — | — | — |
| `/orders/:id/rate` | POST | — | — | — |
| `/orders/:id/request-rematch` | POST | — | — | — |
| `/orders/:id/reschedule` | POST | — | — | — |
| `/orders/:id/reschedule-options` | GET | — | — | — |
| `/orders/:id/reschedule-requests` | GET | — | — | — |
| `/orders/:id/reschedule-requests/:requestId/approve` | POST | — | — | — |
| `/orders/:id/reschedule-requests/:requestId/reject` | POST | — | — | — |
| `/orders/:id/select-provider` | POST | — | — | — |
| `/orders/:id/team-members` | GET | — | — | — |
| `/orders/:orderId/installment-application` | POST | — | — | — |
| `/orders/:orderId/installment-options` | GET | — | — | — |
| `/orders/match-preview` | POST | — | — | — |
| `/orders/preview` | POST | — | — | — |
| `/orders/pricing-field-images` | POST | — | — | — |
| `/orders/problem-images` | POST | — | — | — |

### `/addresses` — العناوين (4 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/addresses` | GET | — | — | — |
| `/addresses` | POST | — | — | — |
| `/addresses/:id` | DELETE | — | — | — |
| `/addresses/:id` | PATCH | — | — | — |

### `/payment-methods` — وسائل الدفع (3 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/payment-methods` | GET | — | — | — |
| `/payment-methods/:id` | DELETE | — | — | — |
| `/payment-methods/:id/default` | PATCH | — | — | — |

### `/customer` — العميل (3 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/customer/marketing-preference` | GET | — | — | — |
| `/customer/marketing-preference` | PATCH | — | — | — |
| `/customer/service-intents` | POST | — | — | — |

### `/complaints` — الشكاوى (7 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/complaints` | GET | — | — | — |
| `/complaints` | POST | — | — | — |
| `/complaints/:id` | GET | — | — | — |
| `/complaints/:id/attachments` | GET | — | — | — |
| `/complaints/:id/attachments` | POST | — | — | — |
| `/complaints/:id/messages` | GET | — | — | — |
| `/complaints/:id/messages` | POST | — | — | — |

### `/support-tickets` — تذاكر الدعم (4 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/support-tickets` | GET | — | — | — |
| `/support-tickets` | POST | — | — | — |
| `/support-tickets/:id` | GET | — | — | — |
| `/support-tickets/:id/satisfaction` | POST | — | — | — |

### `/chat` — المحادثات (5 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/chat/orders/:orderId/thread` | GET | — | — | — |
| `/chat/support-thread` | GET | — | — | — |
| `/chat/threads/:id/messages` | GET | — | — | — |
| `/chat/threads/:id/messages` | POST | — | — | — |
| `/chat/threads/:id/messages/image` | POST | — | — | — |

### `/notifications` — الإشعارات (4 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/notifications` | GET | — | — | — |
| `/notifications/:id/read` | PATCH | — | — | — |
| `/notifications/read-all` | PATCH | — | — | — |
| `/notifications/unread-count` | GET | — | — | — |

### `/loyalty` — الولاء (3 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/loyalty/balance` | GET | — | — | — |
| `/loyalty/redeem` | POST | — | — | — |
| `/loyalty/transactions` | GET | — | — | — |

### `/technician` — الفني (94 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/technician/assistant` | DELETE | — | — | — |
| `/technician/assistant-offers/:id/accept` | POST | — | — | — |
| `/technician/assistant-offers/:id/reject` | POST | — | — | — |
| `/technician/assistant-offers/available` | GET | — | — | — |
| `/technician/assistant-request` | POST | — | — | — |
| `/technician/availability` | PATCH | — | — | — |
| `/technician/categories` | GET | — | — | — |
| `/technician/categories` | POST | — | — | — |
| `/technician/categories/:id` | DELETE | — | — | — |
| `/technician/certificates` | GET | — | — | — |
| `/technician/certificates` | POST | — | — | — |
| `/technician/certificates/:id` | DELETE | — | — | — |
| `/technician/company` | GET | — | — | — |
| `/technician/company` | PATCH | — | — | — |
| `/technician/company` | POST | — | — | — |
| `/technician/company/branches` | POST | — | — | — |
| `/technician/company/branches/:branchId` | PATCH | — | — | — |
| `/technician/company/orders` | GET | — | — | — |
| `/technician/company/staff` | POST | — | — | — |
| `/technician/company/staff/:userId` | DELETE | — | — | — |
| `/technician/company/staff/:userId` | PATCH | — | — | — |
| `/technician/company/transfer-ownership` | POST | — | — | — |
| `/technician/documents` | GET | — | — | — |
| `/technician/documents` | POST | — | — | — |
| `/technician/earnings/months` | GET | — | — | — |
| `/technician/earnings/statement` | GET | — | — | — |
| `/technician/kpi` | GET | — | — | — |
| `/technician/level` | GET | — | — | — |
| `/technician/location` | POST | — | — | — |
| `/technician/me` | GET | — | — | — |
| `/technician/national-id` | PATCH | — | — | — |
| `/technician/orders/:id` | GET | — | — | — |
| `/technician/orders/:id/accept` | POST | — | — | — |
| `/technician/orders/:id/arrive` | POST | — | — | — |
| `/technician/orders/:id/cancel` | POST | — | — | — |
| `/technician/orders/:id/cancellation-policy` | GET | — | — | — |
| `/technician/orders/:id/cash-not-received` | POST | — | — | — |
| `/technician/orders/:id/collect-cash` | POST | — | — | — |
| `/technician/orders/:id/complete` | POST | — | — | — |
| `/technician/orders/:id/continue-another-day` | POST | — | — | — |
| `/technician/orders/:id/depart` | POST | — | — | — |
| `/technician/orders/:id/media` | GET | — | — | — |
| `/technician/orders/:id/media` | POST | — | — | — |
| `/technician/orders/:id/quote-items` | GET | — | — | — |
| `/technician/orders/:id/quote-items` | POST | — | — | — |
| `/technician/orders/:id/rate` | POST | — | — | — |
| `/technician/orders/:id/recruit-candidates` | GET | — | — | — |
| `/technician/orders/:id/recruit-candidates/:technicianId` | POST | — | — | — |
| `/technician/orders/:id/reject` | POST | — | — | — |
| `/technician/orders/:id/report-failed-visit` | POST | — | — | — |
| `/technician/orders/:id/reschedule-requests` | GET | — | — | — |
| `/technician/orders/:id/reschedule-requests` | POST | — | — | — |
| `/technician/orders/:id/start` | POST | — | — | — |
| `/technician/orders/:id/submit-diagnosis-revision` | POST | — | — | — |
| `/technician/orders/:id/submit-initial-quote` | POST | — | — | — |
| `/technician/orders/:id/team-members` | GET | — | — | — |
| `/technician/orders/:id/team-members` | POST | — | — | — |
| `/technician/orders/:id/team-members/:memberId` | DELETE | — | — | — |
| `/technician/orders/active` | GET | — | — | — |
| `/technician/orders/active-orders` | GET | — | — | — |
| `/technician/orders/available` | GET | — | — | — |
| `/technician/orders/overdue` | GET | — | — | — |
| `/technician/orders/team-assigned` | GET | — | — | — |
| `/technician/orders/upcoming-confirmed` | GET | — | — | — |
| `/technician/orders/work-opportunities` | GET | — | — | — |
| `/technician/orders/work-opportunities/:id/accept` | POST | — | — | — |
| `/technician/orders/work-opportunities/:id/decline` | POST | — | — | — |
| `/technician/orders/work-opportunities/:opportunityId/accept-crew` | POST | — | — | — |
| `/technician/orders/work-opportunities/:opportunityId/decline-crew` | POST | — | — | — |
| `/technician/orders/work-opportunities/crew` | GET | — | — | — |
| `/technician/payouts` | GET | — | — | — |
| `/technician/payouts` | POST | — | — | — |
| `/technician/payouts/:id/order-items` | GET | — | — | — |
| `/technician/portfolio-links` | GET | — | — | — |
| `/technician/portfolio-links` | POST | — | — | — |
| `/technician/portfolio-links/:id` | DELETE | — | — | — |
| `/technician/preferred-crew` | GET | — | — | — |
| `/technician/preferred-crew` | POST | — | — | — |
| `/technician/preferred-crew/:id` | DELETE | — | — | — |
| `/technician/preferred-crew/:id/leave` | POST | — | — | — |
| `/technician/preferred-crew/invitations` | GET | — | — | — |
| `/technician/preferred-crew/invitations/:id/accept` | POST | — | — | — |
| `/technician/preferred-crew/invitations/:id/decline` | POST | — | — | — |
| `/technician/preferred-crew/memberships` | GET | — | — | — |
| `/technician/profile` | PATCH | — | — | — |
| `/technician/progression` | GET | — | — | — |
| `/technician/referrals` | GET | — | — | — |
| `/technician/schedule` | GET | — | — | — |
| `/technician/schedule` | POST | — | — | — |
| `/technician/schedule/:id` | DELETE | — | — | — |
| `/technician/schedule/bulk` | POST | — | — | — |
| `/technician/services` | GET | — | — | — |
| `/technician/services` | POST | — | — | — |
| `/technician/services/:id` | DELETE | — | — | — |

### `/internal-chat` — المحادثات الداخلية (5 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/internal-chat/contacts` | GET | — | — | — |
| `/internal-chat/threads` | GET | — | — | — |
| `/internal-chat/threads` | POST | — | — | — |
| `/internal-chat/threads/:id/messages` | GET | — | — | — |
| `/internal-chat/threads/:id/messages` | POST | — | — | — |

### `/admin` — الإدارة (340 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/admin/academy/courses` | GET | `academy.manage` | — | — |
| `/admin/academy/courses` | POST | `academy.manage` | — | — |
| `/admin/academy/courses/:id` | PATCH | `academy.manage` | — | — |
| `/admin/academy/exam-attempts` | POST | `academy.manage` | — | — |
| `/admin/academy/technicians/:technicianId/exam-attempts` | GET | `academy.manage` | — | — |
| `/admin/areas` | GET | `geo.manage` | — | — |
| `/admin/areas` | POST | `geo.manage` | — | — |
| `/admin/areas/:id` | DELETE | `geo.manage` | — | — |
| `/admin/areas/:id` | PATCH | `geo.manage` | — | — |
| `/admin/audit-logs` | GET | `audit.view` | — | — |
| `/admin/branding` | GET | `branding.manage` | نعم | — |
| `/admin/branding/:assetType` | DELETE | — | نعم | — |
| `/admin/branding/:assetType` | POST | `branding.manage` | نعم | — |
| `/admin/buildings` | GET | — | — | — |
| `/admin/buildings` | POST | `buildings.manage` | — | — |
| `/admin/buildings/:id` | GET | — | — | — |
| `/admin/buildings/:id` | PATCH | `buildings.manage` | — | — |
| `/admin/buildings/:id/qr` | GET | — | — | — |
| `/admin/campaigns` | GET | `campaigns.manage` | — | — |
| `/admin/campaigns` | POST | `campaigns.manage` | — | — |
| `/admin/campaigns/:id` | DELETE | `campaigns.manage` | — | — |
| `/admin/campaigns/:id` | PATCH | `campaigns.manage` | — | — |
| `/admin/campaigns/abandoned-leads` | GET | `campaigns.manage` | — | — |
| `/admin/campaigns/run-sweep` | POST | `campaigns.manage` | — | — |
| `/admin/cancellation-reasons` | GET | `cancellation_reasons.manage` | — | — |
| `/admin/cancellation-reasons` | POST | `cancellation_reasons.manage` | — | — |
| `/admin/cancellation-reasons/:id` | PATCH | `cancellation_reasons.manage` | — | — |
| `/admin/cities` | GET | `geo.manage` | — | — |
| `/admin/cities` | POST | `geo.manage` | — | — |
| `/admin/cities/:id` | DELETE | `geo.manage` | — | — |
| `/admin/cities/:id` | PATCH | `geo.manage` | — | — |
| `/admin/complaints` | GET | — | — | — |
| `/admin/complaints/:id/close` | POST | `complaints.resolve` | — | — |
| `/admin/complaints/:id/reject` | POST | `complaints.resolve` | نعم | — |
| `/admin/complaints/:id/resolve` | POST | `complaints.resolve` | نعم | — |
| `/admin/complaints/:id/severity` | PATCH | `complaints.resolve` | — | — |
| `/admin/countries` | GET | `geo.manage` | — | — |
| `/admin/customers` | GET | — | — | — |
| `/admin/customers/:userId` | DELETE | `customers.manage` | — | — |
| `/admin/customers/:userId` | GET | — | — | — |
| `/admin/customers/:userId/360` | GET | — | — | — |
| `/admin/customers/:userId/addresses` | GET | `customers.manage` | — | — |
| `/admin/customers/:userId/block` | POST | `customers.manage` | — | — |
| `/admin/customers/:userId/loyalty/credit` | POST | `promotions.manage` | — | — |
| `/admin/customers/:userId/orders` | GET | — | — | — |
| `/admin/customers/:userId/unblock` | POST | `customers.manage` | — | — |
| `/admin/dashboard/stats` | GET | `reports.view` | — | — |
| `/admin/earnings-policy` | GET | `earnings_policy.view` | نعم | — |
| `/admin/earnings-policy/cutover` | POST | `earnings_policy.manage` | نعم | — |
| `/admin/earnings-policy/levels/:level` | PATCH | `earnings_policy.view` | نعم | — |
| `/admin/earnings-policy/services/:id/commission` | PATCH | `earnings_policy.view` | نعم | — |
| `/admin/earnings-policy/services/:id/levels/:level` | DELETE | `earnings_policy.manage` | نعم | — |
| `/admin/earnings-policy/services/:id/levels/:level` | PUT | `technician_earning_adjustment.manage` | نعم | — |
| `/admin/earnings-policy/services/:id/skills/:skill` | DELETE | `earnings_policy.manage` | نعم | — |
| `/admin/earnings-policy/services/:id/skills/:skill` | PUT | `earnings_policy.manage` | نعم | — |
| `/admin/earnings-policy/simulate` | POST | `earnings_policy.manage` | نعم | — |
| `/admin/earnings-policy/skills/:skill` | PATCH | `earnings_policy.manage` | نعم | — |
| `/admin/earnings-policy/technicians/:id/adjustments` | POST | `earnings_policy.manage` | نعم | — |
| `/admin/employees` | GET | `employees.manage` | — | — |
| `/admin/employees` | POST | `employees.manage` | — | — |
| `/admin/employees/:userId` | DELETE | `employees.manage` | — | — |
| `/admin/employees/:userId` | GET | `employees.manage` | — | — |
| `/admin/employees/:userId` | PATCH | `employees.manage` | — | — |
| `/admin/employees/:userId/block` | POST | `employees.manage` | — | — |
| `/admin/employees/:userId/unblock` | POST | `employees.manage` | — | — |
| `/admin/feature-flags` | GET | — | — | — |
| `/admin/feature-flags` | POST | `feature_flags.manage` | — | — |
| `/admin/feature-flags/:key` | DELETE | `feature_flags.manage` | — | — |
| `/admin/feature-flags/:key` | GET | `feature_flags.manage` | — | — |
| `/admin/feature-flags/:key` | PATCH | `feature_flags.manage` | — | — |
| `/admin/installments/applications` | GET | `installments.view` | — | — |
| `/admin/installments/applications/:id` | GET | `installments.view` | — | — |
| `/admin/installments/applications/:id/approve` | POST | `installments.view` | نعم | — |
| `/admin/installments/applications/:id/reject` | POST | `installments.review` | نعم | — |
| `/admin/installments/documents/:documentId/url` | GET | `installments.review` | — | — |
| `/admin/installments/plans` | GET | `installments.review` | — | — |
| `/admin/installments/plans` | POST | `installments.manage` | — | — |
| `/admin/installments/plans/:id` | PATCH | `installments.manage` | — | — |
| `/admin/installments/plans/:planId/services` | GET | `installments.manage` | — | — |
| `/admin/installments/schedules` | GET | `installments.view` | — | — |
| `/admin/installments/services/:serviceId/plans/:planId/link` | POST | `installments.manage` | — | — |
| `/admin/installments/services/:serviceId/plans/:planId/unlink` | POST | `installments.manage` | — | — |
| `/admin/me/permissions` | GET | — | — | — |
| `/admin/notification-routing-rules` | GET | `notifications.manage` | — | — |
| `/admin/notification-routing-rules` | POST | `notifications.manage` | — | — |
| `/admin/notification-routing-rules/:id` | DELETE | `notifications.manage` | — | — |
| `/admin/notification-routing-rules/:id` | PATCH | `notifications.manage` | — | — |
| `/admin/notification-type-configs` | GET | `notifications.manage` | — | — |
| `/admin/notification-type-configs/:notificationType` | PATCH | `notifications.manage` | — | — |
| `/admin/operations/coverage` | GET | — | — | — |
| `/admin/operations/dispatch-delivery` | GET | — | — | — |
| `/admin/operations/exceptions` | GET | — | — | — |
| `/admin/operations/order-traces` | GET | — | — | — |
| `/admin/operations/order-traces/:orderId` | GET | — | — | — |
| `/admin/operations/overview` | GET | — | — | — |
| `/admin/operations/workload-forecast` | GET | — | — | — |
| `/admin/orders` | GET | — | — | — |
| `/admin/orders/:id` | GET | — | — | — |
| `/admin/orders/:id/adjust-price` | PATCH | `orders.reschedule` | نعم | — |
| `/admin/orders/:id/assistants` | POST | `orders.assign_assistant` | — | — |
| `/admin/orders/:id/cancel` | POST | `orders.cancel` | — | — |
| `/admin/orders/:id/earning-shares` | GET | — | — | — |
| `/admin/orders/:id/eligible-assistants` | GET | `orders.assign_assistant` | — | — |
| `/admin/orders/:id/eligible-technicians` | GET | `orders.reassign` | — | — |
| `/admin/orders/:id/explain-candidates` | GET | `orders.reassign` | — | — |
| `/admin/orders/:id/financial-summary` | GET | — | — | — |
| `/admin/orders/:id/matching-funnel` | GET | — | — | — |
| `/admin/orders/:id/media` | GET | `orders.adjust_price` | — | — |
| `/admin/orders/:id/notes` | GET | — | — | — |
| `/admin/orders/:id/notes` | POST | — | — | — |
| `/admin/orders/:id/photo-quote` | POST | `orders.adjust_price` | نعم | — |
| `/admin/orders/:id/problem-images` | POST | `orders.adjust_price` | — | — |
| `/admin/orders/:id/quote-items` | GET | — | — | — |
| `/admin/orders/:id/quotes` | GET | — | — | — |
| `/admin/orders/:id/quotes/:quoteId/above-range-decision` | POST | `orders.adjust_price` | نعم | — |
| `/admin/orders/:id/quotes/reissue` | POST | `orders.adjust_price` | نعم | — |
| `/admin/orders/:id/reassign` | POST | `orders.reassign` | — | — |
| `/admin/orders/:id/reassign-leader` | POST | `orders.manage_crew` | — | — |
| `/admin/orders/:id/refund` | POST | `refunds.view` | نعم | — |
| `/admin/orders/:id/release-revisit` | POST | `orders.release_revisit` | نعم | — |
| `/admin/orders/:id/request-assessment-info` | POST | `orders.adjust_price` | نعم | — |
| `/admin/orders/:id/reschedule` | POST | `orders.reschedule` | — | — |
| `/admin/orders/:id/reschedule-options` | GET | `orders.reschedule` | — | — |
| `/admin/orders/:id/resolve-cash-dispute` | POST | `orders.resolve_cash_dispute` | نعم | — |
| `/admin/orders/:id/resolve-failed-visit` | POST | `orders.resolve_failed_visit` | نعم | — |
| `/admin/orders/:id/route-to-onsite-assessment` | POST | `orders.adjust_price` | نعم | — |
| `/admin/orders/:id/team-members` | GET | — | — | — |
| `/admin/orders/:id/team-members` | POST | `orders.manage_crew` | — | — |
| `/admin/orders/:id/team-members/:memberId/remove` | POST | `orders.manage_crew` | — | — |
| `/admin/orders/:id/team-members/:memberId/replace` | POST | `orders.manage_crew` | — | — |
| `/admin/orders/:id/technicians/:technicianId/explain` | GET | — | — | — |
| `/admin/orders/:id/timeline` | GET | `orders.cancel` | — | — |
| `/admin/orders/:id/work-opportunities` | GET | — | — | — |
| `/admin/orders/assessment-queue` | GET | — | — | — |
| `/admin/orders/for-customer` | POST | `orders.create_for_customer` | — | — |
| `/admin/payment-policies` | GET | `payment_policies.manage` | — | عام |
| `/admin/payment-policies` | POST | `payment_policies.manage` | — | — |
| `/admin/payment-policies/:id` | PATCH | `payment_policies.manage` | — | — |
| `/admin/payment-policies/:id/versions` | GET | `payment_policies.manage` | — | — |
| `/admin/payment-policies/:id/versions` | POST | `payment_policies.manage` | — | — |
| `/admin/payments/:id/confirm-instapay` | POST | `payments.confirm_manual` | نعم | — |
| `/admin/payments/:id/reject-instapay` | POST | `payments.confirm_manual` | نعم | — |
| `/admin/payments/instapay-pending` | GET | `payments.confirm_manual` | نعم | — |
| `/admin/payments/instapay-qr` | DELETE | `settings.manage` | نعم | — |
| `/admin/payments/instapay-qr` | GET | `settings.manage` | نعم | — |
| `/admin/payments/instapay-qr` | POST | `settings.manage` | نعم | — |
| `/admin/payments/instapay-qr` | PUT | `settings.manage` | نعم | — |
| `/admin/payouts` | GET | `payouts.view` | — | — |
| `/admin/payouts/:id/approve` | POST | `payments.confirm_manual` | نعم | — |
| `/admin/payouts/:id/complete` | POST | `payouts.approve` | نعم | — |
| `/admin/payouts/:id/order-items` | GET | `payouts.view` | — | — |
| `/admin/payouts/:id/reject` | POST | `payouts.approve` | نعم | — |
| `/admin/permissions` | GET | — | — | — |
| `/admin/pricing-templates` | GET | — | — | — |
| `/admin/projects` | GET | `projects.view` | — | — |
| `/admin/projects/:id/comments` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/linkable-orders` | GET | `projects.view` | — | — |
| `/admin/projects/:id/milestones` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/milestones/:milestoneId/complete` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/milestones/:milestoneId/start` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/orders/:orderId/link` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/quotes` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/quotes/:quoteId/send` | POST | `projects.manage` | — | — |
| `/admin/projects/:id/room` | GET | `projects.view` | — | — |
| `/admin/projects/:id/transition` | POST | `projects.view` | — | — |
| `/admin/projects/:id/warranties` | POST | `projects.manage` | — | — |
| `/admin/promo-codes` | GET | `promotions.manage` | — | — |
| `/admin/promo-codes` | POST | `promotions.manage` | — | — |
| `/admin/promo-codes/:id/deactivate` | POST | `promotions.manage` | — | — |
| `/admin/recurring-orders` | GET | `recurring_orders.view` | — | — |
| `/admin/refunds` | GET | `refunds.view` | نعم | — |
| `/admin/reports/revenue` | GET | `reports.view` | — | — |
| `/admin/reports/technicians` | GET | `reports.view` | — | — |
| `/admin/reports/zones` | GET | `reports.view_revenue` | — | — |
| `/admin/roles` | GET | — | — | — |
| `/admin/roles` | POST | `roles.manage` | نعم | — |
| `/admin/roles/:id` | DELETE | `roles.manage` | نعم | — |
| `/admin/roles/:id` | GET | `roles.manage` | نعم | — |
| `/admin/roles/:id` | PATCH | `roles.manage` | نعم | — |
| `/admin/roles/:id/clone` | POST | `roles.manage` | نعم | — |
| `/admin/roles/:id/permissions` | PUT | `roles.manage` | نعم | — |
| `/admin/security/events` | GET | `security.alerts.view` | — | — |
| `/admin/security/events/:id` | GET | `security.alerts.view` | — | — |
| `/admin/security/events/:id/acknowledge` | POST | `security.alerts.view` | — | — |
| `/admin/security/events/:id/investigate` | POST | `security.alerts.manage` | — | — |
| `/admin/security/events/:id/notes` | GET | `security.alerts.view` | — | — |
| `/admin/security/events/:id/notes` | POST | `security.alerts.view` | — | — |
| `/admin/security/events/:id/resolve` | POST | `security.alerts.manage` | — | — |
| `/admin/security/overview` | GET | `security.alerts.view` | — | — |
| `/admin/service-categories` | GET | `catalog.manage` | — | — |
| `/admin/service-categories` | POST | `catalog.manage` | — | — |
| `/admin/service-categories/:id` | DELETE | `catalog.manage` | — | — |
| `/admin/service-categories/:id` | PATCH | `catalog.manage` | — | — |
| `/admin/service-categories/:id/media/:slot` | DELETE | `catalog.manage` | — | — |
| `/admin/service-categories/:id/media/:slot` | POST | `catalog.manage` | — | — |
| `/admin/service-zones` | GET | `geo.manage` | — | — |
| `/admin/service-zones` | POST | `geo.manage` | — | — |
| `/admin/service-zones/:id` | DELETE | `geo.manage` | — | — |
| `/admin/service-zones/:id` | PATCH | `geo.manage` | — | — |
| `/admin/service-zones/:id/boundary` | GET | `geo.manage` | — | — |
| `/admin/service-zones/:id/boundary` | PUT | `geo.manage` | — | — |
| `/admin/services` | GET | `catalog.manage` | — | — |
| `/admin/services` | POST | `catalog.manage` | — | — |
| `/admin/services/:id` | DELETE | `catalog.manage` | — | — |
| `/admin/services/:id` | PATCH | `catalog.manage` | — | — |
| `/admin/services/:id/addons` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/addons` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/level-pricing` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/level-pricing` | PUT | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-fields` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-fields` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-rules` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-rules` | PUT | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-tests` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-tests` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-tests/run` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-tier-pricing` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-tier-pricing` | PUT | `catalog.manage` | — | — |
| `/admin/services/:id/pricing-usages` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/pricing/apply-template` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/pricing/evaluate-draft` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/standard-data` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/standard-data` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/technicians` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/technicians` | POST | `catalog.manage` | — | — |
| `/admin/services/:id/technicians/:technicianId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/:id/zone-pricing` | GET | `catalog.manage` | — | — |
| `/admin/services/:id/zone-pricing` | PUT | `catalog.manage` | — | — |
| `/admin/services/addons/:addonId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/addons/:addonId` | PATCH | `catalog.manage` | — | — |
| `/admin/services/level-pricing/:pricingId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/pricing-fields/:fieldId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/pricing-fields/:fieldId` | PATCH | `catalog.manage` | — | — |
| `/admin/services/pricing-rules/:ruleId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/pricing-tests/:testId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/pricing-tier-pricing/:pricingId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/productivity-suggestions` | GET | — | — | — |
| `/admin/services/productivity-suggestions/:id/approve` | POST | `catalog.manage` | — | — |
| `/admin/services/productivity-suggestions/:id/reject` | POST | `catalog.manage` | — | — |
| `/admin/services/productivity-suggestions/generate` | POST | `catalog.manage` | — | — |
| `/admin/services/standard-data/:standardDataId` | DELETE | `catalog.manage` | — | — |
| `/admin/services/standard-data/:standardDataId` | PATCH | `catalog.manage` | — | — |
| `/admin/services/standard-data/:standardDataId/actuals` | GET | `catalog.manage` | — | — |
| `/admin/services/standard-data/:standardDataId/actuals` | POST | `catalog.manage` | — | — |
| `/admin/services/zone-pricing/:pricingId` | DELETE | `catalog.manage` | — | — |
| `/admin/settings` | GET | `settings.manage` | — | — |
| `/admin/settings/:key` | GET | `settings.manage` | — | — |
| `/admin/settings/:key` | PATCH | `settings.manage` | نعم | — |
| `/admin/support-chat-threads` | GET | `support_tickets.manage` | — | — |
| `/admin/support-tickets` | GET | `support_tickets.manage` | — | — |
| `/admin/support-tickets/:id/assign` | PATCH | `support_tickets.manage` | — | — |
| `/admin/support-tickets/:id/status` | PATCH | `support_tickets.manage` | — | — |
| `/admin/technician-companies` | GET | — | — | — |
| `/admin/technician-companies/:id` | GET | — | — | — |
| `/admin/technician-companies/:id/orders` | GET | — | — | — |
| `/admin/technician-companies/:id/price-multiplier` | PATCH | `orders.adjust_price` | — | — |
| `/admin/technician-companies/:id/trust-badge` | PATCH | `technicians.approve` | — | — |
| `/admin/technician-kpi` | GET | `technician_kpi.calculate` | — | — |
| `/admin/technician-kpi/:id` | GET | — | — | — |
| `/admin/technician-kpi/:id/approve` | PATCH | `technician_kpi.approve` | — | — |
| `/admin/technician-kpi/:id/pay` | POST | `technician_kpi.approve` | — | — |
| `/admin/technician-kpi/:id/reject` | PATCH | `technician_kpi.approve` | — | — |
| `/admin/technician-kpi/calculate` | POST | `technician_kpi.calculate` | — | — |
| `/admin/technician-kpi/technicians/:id/history` | GET | — | — | — |
| `/admin/technician-levels` | GET | `technician_levels.manage` | — | — |
| `/admin/technician-levels/:level` | PATCH | `technician_levels.manage` | — | — |
| `/admin/technician-productivity/:technicianId` | GET | `technician_productivity.view` | — | — |
| `/admin/technician-progression` | GET | `technician_progression.manage_rules` | — | — |
| `/admin/technician-progression/:id` | GET | `technician_progression.approve` | — | — |
| `/admin/technician-progression/:id/approve` | PATCH | `technician_progression.approve` | — | — |
| `/admin/technician-progression/:id/override` | PATCH | `technician_progression.approve` | — | — |
| `/admin/technician-progression/:id/reject` | PATCH | `technician_progression.override` | — | — |
| `/admin/technician-progression/calculate` | POST | `technician_progression.manage_rules` | — | — |
| `/admin/technician-progression/rules` | GET | `technician_progression.manage_rules` | — | — |
| `/admin/technician-progression/rules/:id` | PATCH | `technician_progression.manage_rules` | — | — |
| `/admin/technician-referrals` | GET | — | — | — |
| `/admin/technician-referrals/technicians/:id` | GET | — | — | — |
| `/admin/technicians` | GET | — | — | — |
| `/admin/technicians/:id` | GET | `technicians.approve` | — | — |
| `/admin/technicians/:id/360` | GET | — | — | — |
| `/admin/technicians/:id/approve` | POST | `technicians.manage` | — | — |
| `/admin/technicians/:id/assistant/approve` | POST | `technicians.manage_zones` | — | — |
| `/admin/technicians/:id/assistant/reject` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/capacity` | GET | — | — | — |
| `/admin/technicians/:id/categories` | GET | — | — | — |
| `/admin/technicians/:id/categories` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/categories/:categoryId` | DELETE | `technicians.approve` | — | — |
| `/admin/technicians/:id/certificates/:certificateId/review` | POST | `technicians.review_documents` | — | — |
| `/admin/technicians/:id/debt` | GET | `wallets.view` | — | — |
| `/admin/technicians/:id/debt/settlements` | POST | `wallets.view` | — | — |
| `/admin/technicians/:id/documents/:documentId/review` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/earnings/months` | GET | — | — | — |
| `/admin/technicians/:id/earnings/reconciliation` | GET | — | — | — |
| `/admin/technicians/:id/earnings/statement` | GET | — | — | — |
| `/admin/technicians/:id/kind` | PATCH | `technicians.approve` | — | — |
| `/admin/technicians/:id/level` | PATCH | `technicians.approve` | — | — |
| `/admin/technicians/:id/mark-documents-submitted` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/mark-test-passed` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/mark-under-review` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/national-id` | GET | `technicians.manage` | — | — |
| `/admin/technicians/:id/national-id` | PATCH | `technicians.manage` | — | — |
| `/admin/technicians/:id/notes` | GET | — | — | — |
| `/admin/technicians/:id/notes` | POST | — | — | — |
| `/admin/technicians/:id/pricing-tier` | PATCH | `technicians.approve` | — | — |
| `/admin/technicians/:id/reject` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/schedule-interview` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/service-permissions` | GET | `technicians.approve` | — | — |
| `/admin/technicians/:id/service-permissions/:serviceId` | DELETE | `technicians.approve` | — | — |
| `/admin/technicians/:id/service-permissions/exclude` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/suspend` | POST | `technicians.approve` | — | — |
| `/admin/technicians/:id/trust-badge` | PATCH | `technicians.approve` | — | — |
| `/admin/technicians/:id/zones` | GET | `technicians.manage_zones` | — | — |
| `/admin/technicians/:id/zones` | POST | `technicians.manage_zones` | — | — |
| `/admin/technicians/:id/zones/:zoneId` | DELETE | `technicians.manage_zones` | — | — |
| `/admin/technicians/by-category` | GET | — | — | — |
| `/admin/technicians/category-declarations` | GET | `technicians.approve` | — | — |
| `/admin/technicians/category-declarations/:id/approve` | POST | `technicians.approve` | — | — |
| `/admin/technicians/category-declarations/:id/reject` | POST | `technicians.approve` | — | — |
| `/admin/technicians/category-declarations/:id/suspend` | POST | `technicians.approve` | — | — |
| `/admin/technicians/debt/outstanding` | GET | `wallets.view` | — | — |
| `/admin/technicians/service-declarations` | GET | `technicians.approve` | — | — |
| `/admin/technicians/service-declarations/:id/approve` | POST | `technicians.approve` | — | — |
| `/admin/technicians/service-declarations/:id/reject` | POST | `technicians.approve` | — | — |
| `/admin/technicians/service-declarations/:id/suspend` | POST | `technicians.approve` | — | — |
| `/admin/users/:id/mfa/reset` | POST | `roles.manage` | نعم | — |
| `/admin/users/:userId/roles` | GET | `roles.manage` | نعم | — |
| `/admin/users/:userId/roles` | POST | `roles.manage` | نعم | — |
| `/admin/users/:userId/roles/:roleName` | DELETE | `roles.manage` | نعم | — |
| `/admin/wallets/:userId` | GET | `wallets.view` | — | — |
| `/admin/wallets/:userId/adjust` | PATCH | `wallets.adjust` | نعم | — |
| `/admin/warranty-claims` | GET | `warranty.view` | — | — |
| `/admin/warranty-claims/:id/review` | PATCH | `warranty.review` | — | — |
| `/admin/warranty-plans` | GET | `warranty.view` | — | — |
| `/admin/warranty-plans` | POST | `warranty.manage` | — | — |
| `/admin/warranty-plans/:id` | PATCH | `warranty.manage` | — | — |
| `/admin/workforce/employees/:userId/presence` | GET | `employees.activity.view` | — | — |
| `/admin/workforce/employees/:userId/sessions` | GET | `employees.activity.view` | — | — |
| `/admin/workforce/employees/:userId/sessions/:sessionId` | DELETE | `employees.activity.view` | — | — |
| `/admin/workforce/heartbeat` | POST | `employees.activity.view` | — | — |
| `/admin/workforce/summary` | GET | `employees.activity.view` | — | — |

### `/academy` — academy (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/academy/courses` | GET | — | — | — |
| `/academy/my-exam-attempts` | GET | — | — | — |

### `/booking-policy` — booking-policy (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/booking-policy` | GET | — | — | عام |

### `/branding` — branding (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/branding` | GET | — | — | عام |

### `/cancellation-reasons` — cancellation-reasons (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/cancellation-reasons` | GET | — | — | عام |

### `/checkout` — checkout (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/checkout/payment-policies` | GET | — | — | عام |

### `/cities` — cities (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/cities` | GET | — | — | عام |
| `/cities/:cityId/areas` | GET | — | — | عام |

### `/devices` — devices (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/devices` | POST | — | — | — |
| `/devices/:deviceId` | DELETE | — | — | — |

### `/feature-flags` — feature-flags (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/feature-flags/:key/check` | GET | — | — | عام |

### `/health` — health (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/health` | GET | — | — | عام |

### `/installment-applications` — installment-applications (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/installment-applications/:applicationId` | DELETE | — | — | — |
| `/installment-applications/:applicationId/documents` | POST | — | — | — |

### `/installment-plans` — installment-plans (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/installment-plans` | GET | — | — | — |

### `/legal-entity` — legal-entity (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/legal-entity` | GET | — | — | عام |

### `/payment-channels` — payment-channels (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/payment-channels` | GET | — | — | — |

### `/promo-codes` — promo-codes (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/promo-codes/:code/validate` | GET | — | — | — |

### `/service-categories` — service-categories (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/service-categories` | GET | — | — | عام |
| `/service-categories/most-requested` | GET | — | — | عام |

### `/settings` — settings (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/settings/homepage-content` | GET | — | — | عام |
| `/settings/support-contact` | GET | — | — | عام |

### `/technician-companies` — technician-companies (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/technician-companies` | GET | — | — | — |

### `/technicians` — technicians (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/technicians/:id/profile` | GET | — | — | — |
| `/technicians/:id/schedule` | GET | — | — | — |

### `/trust-info` — trust-info (1 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/trust-info` | GET | — | — | عام |

### `/wallet` — wallet (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/wallet` | GET | — | — | — |
| `/wallet/transactions` | GET | — | — | — |

### `/webhooks` — webhooks (2 مسار)

| المسار | الفعل | الصلاحية | Step-Up | عام |
|---|---|---|---|---|
| `/webhooks/fawry` | POST | — | — | عام |
| `/webhooks/paymob` | POST | — | — | عام |
