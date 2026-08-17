# Script 1 — Root-Cause Matrix: Core Integrity

## Scope and operating rules

This is the working matrix for the user-provided **SONNA3 Script 1**. It is
based on the repository at commit `1e668d9c60a9bc88988a0212bf4789e1078504d6`.
The repository remains the source of truth: every listed finding is verified
against current code, tests, migrations, and module documentation before a
change is made.

Final finding statuses use only the Script 1 vocabulary:

- `VERIFIED FIXED`
- `ALREADY FIXED — VERIFIED`
- `PARTIAL`
- `NOT FIXED`
- `NOT REPRODUCIBLE — WITH EVIDENCE`
- `OWNER DECISION REQUIRED`

This document is intentionally phase-based. No change is made to a later
phase until its related findings have been inspected and added here with
evidence.

## Phase 1 — Payment truth and webhook lifecycle

### Shared invariant

One logical provider payment may create **at most one** financial settlement,
but a local timeout, crash, or duplicate delivery must never discard a later
authoritative provider result. A received webhook is deduplicated only after
its business effect is terminally known; a failed or interrupted attempt stays
recoverable.

### Current paths inspected

- `apps/api/src/modules/payments/payments.service.ts`
- `apps/api/src/modules/payments/webhooks.controller.ts`
- `apps/api/src/modules/payments/entities/payment.entity.ts`
- `apps/api/src/modules/payments/entities/webhook-event.entity.ts`
- `apps/api/src/modules/payments/gateways/paymob-provider.service.ts`
- `infra/migrations/0008_finance.sql`, `infra/migrations/0011_system.sql`,
  and `infra/migrations/0092_payment_provider_architecture.sql`
- Existing regression tests in `webhooks.controller.spec.ts` and
  `webhook-amount-verification.spec.ts`

| Script section | Current code path / observed behavior | Root cause and missing protection | Status |
| --- | --- | --- | --- |
| 11–12 — provider truth and payment states | `PaymentsService.initiateProviderCharge()` changes a `Payment` to `FAILED` when `provider.createPayment()` throws. A network timeout cannot prove the provider did not create a charge/intention. | The existing `PROCESSING` state is unused for payments, and the code collapses an unknown external outcome into a confirmed failure. | `PARTIAL` |
| 13 — failed webhook retry | `finalizeGatewayWebhook()` returns immediately whenever any row exists for `externalEventId`, including a row in `FAILED`. | Existence is treated as completion, so the exact provider retry cannot recover a previous local failure. | `NOT FIXED` |
| 14 — webhook identity | `WebhookEvent.externalEventId` is globally unique. | The source does not establish that different providers share one global event-ID namespace. The safe identity must be verified and, if necessary, scoped by provider. | `PARTIAL` |
| 15 — atomic claim | `findOne({ externalEventId })` runs before `save(webhookEvent)`. | This is a check-then-insert race. The unique constraint is useful, but duplicate delivery can still produce an unhandled unique-constraint failure instead of clean idempotent behavior. | `NOT FIXED` |
| 16 — recovery / reconciliation | `WebhookEvent` has `RECEIVED`, `PROCESSING`, `FAILED`, `retryCount`, and `errorMessage`, but no worker or reconciliation consumer reads `retryCount` or resumes failed/stale rows. | Failed and interrupted processing have durable evidence but no bounded recovery path or operational queue. | `NOT FIXED` |
| 17–18 — timeout and late provider success | A timeout during registration can leave `Payment.paymentStatus = FAILED`; `finalizeGatewayWebhook()` accepts only `PENDING` payments and ignores a later success for `FAILED`. | Authoritative provider success cannot reconcile a locally uncertain failure. | `NOT FIXED` |
| 19 — webhook security | HMAC verification, payment mapping, and amount comparison exist. The parsed webhook result does not carry an expected currency or merchant/environment identity into the final settlement check. | Security controls are present but the full provider-context validation required by Script 1 is not expressed at the settlement boundary. | `PARTIAL` |
| 20 — operational reconciliation | `PaymentProvider.reconcile()` exists, but no authorized service/controller/worker invokes it for pending, unknown, or failed webhook processing. | The provider capability is disconnected from an observable, audited recovery operation. | `NOT FIXED` |
| 21 — test matrix | Existing tests cover invalid signatures, amount mismatch, and controller error propagation. | No current test proves concurrent duplicate delivery, failed-event retry, crash recovery, late success after an unknown local outcome, or final DB state for those cases. | `PARTIAL` |

### Coherent architectural correction

The first implementation unit will make the webhook lifecycle an explicit,
recoverable state machine rather than independent patches:

1. Claim a provider-scoped event atomically and make duplicate delivery return
   a clean no-op only for a terminally handled event.
2. Preserve an unknown provider-registration result as reconcilable rather
   than marking it as a confirmed failure.
3. Permit a verified late provider result to reconcile an eligible payment
   exactly once under the same transaction/locking boundary that settles the
   order.
4. Add a bounded, observable recovery path for interrupted webhook handling;
   it must not introduce an unbounded retry loop or a second settlement path.
5. Add database-state regression tests for duplicate, concurrent, failed, and
   late deliveries.

### Implementation and verification record — 2026-08-17

Implemented in this branch, as one lifecycle change rather than isolated
patches:

- `0113_webhook_recovery_lifecycle.sql` replaces the global identity constraint
  with `(provider, external_event_id)`, adds durable claim/retry timestamps,
  indexes recovery candidates, and adds bounded recovery settings.
- `PaymentsService` uses an atomic PostgreSQL claim, distinguishes terminal
  from retryable webhook outcomes, accepts a verified late result for a local
  `PROCESSING` payment, and keeps a registration timeout in `PROCESSING` rather
  than allowing a new client attempt to create a second provider charge.
- `WebhookRecoveryService` recovers due failed and stale processing rows after
  re-verifying the stored provider delivery signature. It uses bounded,
  exponential backoff and does not depend on Redis/BullMQ.
- Unit tests cover unknown provider-registration state, duplicate client tap
  protection, and recovery-worker candidate isolation. Existing webhook and
  Paymob provider unit suites still pass.

Verification performed locally:

- `npm run build` — passed.
- `jest --runInBand payments.provider-outcome.spec.ts webhook-recovery.service.spec.ts`
  — 4 tests passed.
- `jest --runInBand webhooks.controller.spec.ts paymob-provider.service.spec.ts`
  — 15 tests passed.
- Migration runner applied `0113_webhook_recovery_lifecycle.sql` to the shared
  PostgreSQL TEST schema after verifying checksums for all preceding migrations.
- `jest --runInBand webhook-amount-verification.spec.ts` against that real
  PostgreSQL database — 6 tests passed: amount mismatch, duplicate delivery,
  failed-event retry after backoff, provider-scoped identity, and simultaneous
  delivery. Every fixture uses a unique test prefix and is removed by the
  suite's cleanup hooks.
- `jest --runInBand refund-transaction-safety.spec.ts` against the same real
  PostgreSQL database — 4 tests passed; it verifies the persisted
  `PROCESSING` row before the provider step and final database states.
- `git diff --check` — passed.

Redis was started and health-checked as part of the shared TEST infrastructure,
but the new recovery path deliberately does not use Redis/BullMQ. No live
Paymob charge or external webhook was issued: this financial regression suite
verifies the complete local persistence/concurrency path without creating a
real customer charge.

### Deferred until the Phase 1 design is verified

- Whether external webhook IDs must be migrated from globally unique to a
  `(provider, external_event_id)` unique constraint. The migration now scopes
  identity by provider because no cross-provider namespace is established in
  the local provider contracts; Paymob and Fawry parse distinct external
  reference sources. Production provider-contract validation remains required.
- The exact operational surface for reconciliation (scheduled worker, an
  audited authorized endpoint, or both). The existing provider API only
  accepts a transaction reference, so recovery of a request that timed out
  before returning such a reference needs a provider-supported lookup path or
  an explicit manual-review state; it must not be guessed.

## Phase 2 — Refund accounting and completion

### Shared invariant

A refund may be shown as `COMPLETED` only after its actual money effect and
all corresponding internal allocation effects commit. When an order has more
than one payment component, the refunded component must be explicit; no
implicit "latest payment" selection may silently reverse unrelated earnings.

### Findings verified before modification

| Script section | Current evidence | Status |
| --- | --- | --- |
| 22 — completion follows money | `refundOrder()` created a wallet-credit fallback as `COMPLETED` in its preparation transaction, while the customer-wallet credit occurred later in a separate transaction. A crash between them left a false completion. The row now starts `PROCESSING`, and completion is saved only after local effects in the final transaction. | `VERIFIED FIXED` — build and the real PostgreSQL refund-transaction suite passed. |
| 23 — source allocation | A refund now accepts `payment_id`; for a multi-component order it is required rather than selecting the latest payment. Technician reversal is proportional to `order.totalAmountCents`, so a smaller additional-work component cannot reverse the whole order's earnings. | `VERIFIED FIXED` |
| 24 — order vs payment state | A payment becomes `REFUNDED` only when its own cumulative completed refunds reach its amount. The order changes to `REFUNDED` only after every paid component reaches that condition. | `VERIFIED FIXED` |
| 25 — multiple partial refunds | Migration `0114_cumulative_refunds_per_payment.sql` replaces the old per-payment unique index with a `(payment_id, refund_status)` index. `PROCESSING` and `COMPLETED` amounts reserve balance under the order lock; `REJECTED` amounts do not. | `VERIFIED FIXED` |
| 26–27 — traceability and concurrency | Every row remains tied to `payment_id`, `order_id`, actors, reason, amount, provider reference, and timestamps. The locked order plus cumulative reservation prevents concurrent requests from exceeding a payment's refundable balance. | `VERIFIED FIXED` |

### Implementation and verification record — 2026-08-17

The branch chooses the conservative compatible policy: `payment_id` stays
optional for an order with exactly one refundable component, but is required
with a clear `409` for multiple components. It never guesses an allocation.

- `0114_cumulative_refunds_per_payment.sql` removes the obsolete unique refund
  index and adds a lookup index for per-payment lifecycle/reconciliation.
- `refundOrder()` permits cumulative partial refunds only up to the remaining
  amount. A pending provider result reserves its amount; a definitive provider
  rejection reserves nothing and may be retried.
- The endpoint now exposes optional `payment_id` in both API DTO and shared
  type. Existing single-payment clients remain compatible.
- `refund-transaction-safety.spec.ts` ran against shared PostgreSQL TEST with
  six passing cases: durable processing, provider rejection/retry, provider
  exception protection, explicit component selection, order-state aggregation,
  cumulative partial refunds, and a concurrent over-refund race.
