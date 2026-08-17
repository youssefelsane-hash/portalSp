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

## Phase 3 — Additional-work lifecycle and concurrency

### Shared invariant

The existing product flow supports sequential additional-work batches, with
only one customer-visible proposal open per order. A customer decision is
terminal and preserves the proposal evidence. Any payment is attributable to
that exact approved batch.

### Implementation and verification record — 2026-08-17

- `0115_additional_work_proposal_lifecycle.sql` adds `pending`, `approved`, and
  `declined` lifecycle state plus decline actor/time to `order_items`; it
  migrates already-approved rows safely and retains declined evidence instead
  of deleting it.
- `propose()`, `approve()`, and `decline()` now lock and reread the order inside
  their transactions. A proposal race yields one winner and a normal domain
  conflict; approve versus decline likewise has exactly one terminal result.
- Approval asserts a single pending `batch_id` before calculating or charging
  its amount. Sequential batches remain supported, but no code can aggregate
  multiple open batches then attach the charge to an arbitrary first one.
- Proposal rows are immutable through the exposed API; therefore the customer
  approves the exact item/price snapshot that was created. Price zero remains
  supported for legitimate free remediation/goodwill items; it creates an
  auditable approved/declined proposal but no additional money obligation.
- `order-items-additional-work-payment.spec.ts` ran against shared PostgreSQL
  TEST with nine passing cases, including proposal race, approve/decline race,
  retained decline evidence, batch-to-payment mapping, and sequential batches.

## Phase 4 — Wallet, referrals, and compensation

### Shared invariant

One logical reward, reversal, adjustment, or complaint decision may create at
most one financial effect. The business source row and its wallet/promo effect
must either commit together or remain durably eligible for recovery. Quotas and
"first only" policies are decisions made under the smallest shared-resource
lock, not pre-transaction observations.

### Findings verified before modification

| Script section | Current evidence | Status |
| --- | --- | --- |
| 36 — referral milestone race | `ReferralsService.handleOrderCompleted()` saves a completed referral, counts completed rows, then creates a promo code without locking the referrer scope. Concurrent milestone completions can both observe the same count or skip a milestone. | `NOT FIXED` |
| 37 — non-durable referral event | Order completion reaches referrals only through an in-process `EventEmitter2` listener which catches and logs failure. There is no database sweep for a committed completed order whose referral listener never ran. | `NOT FIXED` |
| 38 — lazy referral-code generation | `getMyReferralInfo()` generates a code and performs an unconditional user update. The unique column prevents two rows sharing a code, but two requests can return different codes and the losing response may not match the persisted value. | `PARTIAL` |
| 39 — wallet credit plus bonus record | `TechnicianReferralsService.evaluateOrderForBonus()` commits `WalletsService.doubleEntry()` first and saves `technician_referral_bonuses` afterward. A crash between the two loses the business source record and makes retry capable of crediting again. | `NOT FIXED` |
| 40 — referral reversal once | `revokeBonusForOrder()` reads a credited bonus and reverses its wallet transactions before changing bonus status, with no bonus-row or original-ledger-row lock. Two callers can both reverse. | `NOT FIXED` |
| 41 — monthly referral limit | The monthly sum and subsequent credit are separate operations without a technician-scoped lock. Concurrent rewards can both pass the cap. | `NOT FIXED` |
| 42 — admin wallet adjustment | Dedicated permission, mandatory step-up, actor, direction, amount, reason, double-entry transaction, and audit already exist. There is no logical operation/idempotency key, so a retry repeats the adjustment. | `PARTIAL` |
| 43 — complaint double resolve | Compensation and complaint state commit in one transaction, but the complaint is read without `FOR UPDATE`. Two resolving transactions can both pass the state check and compensate. | `NOT FIXED` |
| 44 — complaint resolve versus reject | `reject()` is outside the resolving transaction and neither path locks the complaint. A rejection can overwrite a compensated resolution. | `NOT FIXED` |
| 45 — first-order-only technician referral | The credited-count check is not serialized at the attribution/customer scope. Two qualifying orders for the same referred customer can both pass before either bonus is visible. | `NOT FIXED` |

### Coherent architectural correction

The Phase 4 implementation unit will reuse the existing double-entry ledger,
transactions, row locks, settings, and periodic database-sweep pattern:

1. Make ledger reversal idempotent under locks on the original transaction
   pair, and persist each manual adjustment as a uniquely keyed business
   operation whose ledger effect commits in the same transaction.
2. Serialize technician-referral policy at the technician and attribution
   rows; perform quota checks, bonus persistence, and double-entry credit in
   one transaction. Reversal locks the bonus and original ledger pair.
3. Lock the complaint row before either terminal decision; compensation and
   the winning decision remain one transaction.
4. Serialize standard referral completion at the referred/referrer rows and
   create the milestone promo in the same transaction. A bounded database
   sweep reconciles pending referrals backed by completed orders, so an
   interrupted in-process event is recoverable.
5. Make lazy referral-code assignment a conditional database update and return
   only the value that is actually persisted.

### Implementation and verification record — 2026-08-17

All Phase 4 findings 36-45 are now `VERIFIED FIXED`:

- Migration `0116_wallet_referral_compensation_integrity.sql` adds durable
  `wallet_adjustments` and `referral_rewards` business-source records, unique
  operation identities, historical referral-promo backfill where identity can
  be proven, and a bounded referral recovery setting.
- Manual wallet adjustment requires `Idempotency-Key` from admin UI through
  controller and commits its source row plus double entry together. Reusing a
  key with another payload returns `409`; a true retry returns the original
  ledger result.
- `WalletsService.reverseDoubleEntry()` locks/reloads both originals and is
  idempotent. Technician referral evaluation locks order, attribution, and
  technician, then commits quota decision, bonus row, and wallet effect in one
  transaction. Revoke locks the bonus and original ledger pair.
- Complaint resolve/reject both use a pessimistic complaint-row lock and a
  post-lock state recheck. Compensation remains in the winning transaction.
- Standard referral completion locks referral/referrer, links each milestone
  to one promo in the same transaction, conditionally assigns legacy referral
  codes, and uses a PostgreSQL sweep to recover missed in-process events.

Verification performed against the shared TEST infrastructure:

- Migration runner verified checksums for migrations `0001` through `0115`
  and applied `0116` successfully.
- Eight PostgreSQL/Redis-backed suites passed under `--detectOpenHandles`: 32
  tests covering failure rollback, concurrent first-order and monthly-cap
  rewards, duplicate reversal, duplicate wallet adjustment, complaint terminal
  races, missed-event recovery, milestone races, lazy code assignment, and
  neighboring refund/cash/payout/promo regressions.
- API `npm run build`, `npx tsc --noEmit`, and `git diff --check` passed.
- Admin build could not start because this workspace does not have the `next`
  executable installed; the API build and TypeScript checks cover the changed
  backend, while the admin header change remains source-reviewed.

## Phase 5 — Domestic-worker financial flows

### Shared invariant

One service period creates at most one pending earning and at most one later
wallet credit. Cancellation, admin decisions, and monthly renewal all serialize
on the booking row, then lock narrower rows in one consistent order. A cron
tick is only a discovery mechanism; the database transaction owns the claim.

### Findings verified before modification

| Script section | Current evidence | Status |
| --- | --- | --- |
| 46 — earning approval race | `approve()` read the approval without a lock, then credited before saving the terminal state. Two requests could both pass `pending`. `reject()` was not transactional. | `NOT FIXED` |
| 47 — admin earning UI | The API endpoints existed, but `/domestic-workers` only reviewed worker profiles. There was no UI to inspect or decide earning approvals. | `NOT FIXED` |
| 48 — cancelled booking | `cancel()` changed only the booking. Existing pending earnings stayed approvable, and `approve()` did not validate booking state. | `NOT FIXED` |
| 49 — multi-instance renewal | Every API instance selected the same due bookings, charged in a separate transaction, then moved `current_period_end_at` afterward without locking. | `NOT FIXED` |

### Implementation and verification record — 2026-08-17

All Phase 5 findings 46-49 are now `VERIFIED FIXED`:

- Migration `0117_domestic_worker_flow_integrity.sql` adds durable source keys,
  a per-booking/source unique index, and the terminal `invalidated` state.
- Approve and reject lock booking then approval and recheck state. Approval
  commits its wallet entry and terminal state together; cancellation uses the
  same lock order and invalidates every pending earning in its transaction.
- Confirmation, hourly completion, and renewal now combine booking state,
  charge, earning creation, and period movement at the appropriate atomic
  boundary. Two schedulers may discover the same row, but only the holder that
  still sees the expected period cursor can renew it.
- The permission-gated `/domestic-worker-earnings` admin screen exposes source,
  booking, worker, amount, previous decision actor/time/reason, and guarded
  approve/reject actions with the existing automatic MFA step-up flow.
- The previous orphan was a Jest process for this suite. The test unnecessarily
  created a real Redis client for one constant setting. It now uses a
  deterministic settings stub and destroys its PostgreSQL DataSource in a
  `finally` block. The stale PID was terminated; the repaired suite exits
  normally under `--detectOpenHandles`.

Verification performed against shared TEST:

- Migration runner verified checksums through `0116` and applied `0117`.
- `domestic-worker-earning-approval.spec.ts`: 8 PostgreSQL tests passed,
  including approve races, terminal-decision race, cancellation invalidation,
  two simultaneous renewal sweeps, and retry after a transient infrastructure
  rollback.
- API `npm run build` passed. Admin typecheck could not run meaningfully because
  the checked-out workspace lacks its declared Next/React/type dependencies;
  this pre-existing dependency gap produces project-wide module errors.

## Phase 6 — Payout transition integrity

### Shared invariant

The payout row serializes every admin transition. Its terminal state and the
reserved-wallet action must commit in the same transaction. Existing wallet
locks and reserved-balance checks remain the source of truth for the ledger.

### Findings verified before modification

| Script section | Current evidence | Status |
| --- | --- | --- |
| 50 — approve versus reject | Approve read and saved outside a transaction. Reject used a transaction but read the payout without a row lock, so stale transitions could diverge from reservation release. | `NOT FIXED` |
| 51 — payout complete | `finalizePayout()` already locked wallets in deterministic order and rejected insufficient reservation, but `adminComplete()` did not lock/re-read the payout transition row. | `PARTIAL` |

### Implementation and verification record — 2026-08-17

Both Phase 6 findings are now `VERIFIED FIXED`:

- A single `lockPayoutOrThrow()` path performs `FOR UPDATE` and is used by
  approve, reject, and complete. Approve now runs in a transaction; reject and
  complete retain their existing atomic wallet effects.
- `WalletsService.finalizePayout()` was deliberately not rewritten. Its ordered
  wallet locks, reserved-balance validation, and double-entry withdrawal remain
  intact behind the newly serialized payout transition.
- The PostgreSQL payout suite now has five passing tests: repeated rejection,
  direct double release, approve×reject coherence, complete×complete exactly
  once, and complete×reject terminal coherence. The test no longer creates an
  unnecessary Redis client and destroys PostgreSQL in `finally`.
- API `npm run build` passed, and the suite exited normally under
  `--detectOpenHandles`.

## Phase 7 — Assignment and schedule concurrency

### Shared invariant

A technician is a shared resource across orders. Every assignment writer uses
the same eligibility policy and lock order, while PostgreSQL prevents both a
second active order and overlapping schedule intervals. An order transition
commits its state, timestamps, and history as one serialized decision.

### Findings verified before modification

| Script section | Current evidence | Status |
| --- | --- | --- |
| 52 — technician shared resource | Acceptance locked only each order, so the same technician could accept two different orders concurrently after both prechecks passed. | `NOT FIXED` |
| 53 — admin reassign eligibility | Admin reassignment checked technician existence but did not apply the matching service/zone/availability/decision-limit/active-work policy. | `NOT FIXED` |
| 54 — accept versus reassign | Acceptance and reassignment did not share resource locking or one eligibility primitive, allowing competing writers to make decisions from different snapshots. | `NOT FIXED` |
| 55 — schedule overlap | `createSlot()` used a select-before-insert overlap check without a database constraint. | `NOT FIXED` |
| 56 — order transition races | Technician transitions and customer/admin cancellation validated an object read before their write transaction, so two legal transitions could both write history from the same old state. | `NOT FIXED` |
| 57 — concurrency proof | Same-order accept had coverage, but same-technician/different-order, accept×reassign, overlapping slot creation, and transition-history races were missing. | `PARTIAL` |

### Implementation and verification record — 2026-08-17

All Phase 7 findings 52-57 are now `VERIFIED FIXED`:

- Migration `0118_assignment_schedule_concurrency.sql` adds a partial unique
  index for one active order per technician and a half-open PostgreSQL
  exclusion constraint for non-overlapping technician schedule slots.
- `TechnicianAssignmentGuardService` locks the technician resource and applies
  one eligibility policy to both technician acceptance and admin reassignment.
  Both paths then lock the order and atomically align its technician pointer,
  accepted assignment, state transitions, and history.
- Technician execution transitions and customer/admin cancellation now lock
  and reread the order, validate the expected state and actor, and persist the
  transition plus history in the same transaction.
- Four real PostgreSQL suites passed under `--detectOpenHandles`: 18 tests for
  same-order accept, same-technician/different-order accept, accept×admin
  reassign, busy-admin rejection, overlapping and adjacent slots,
  complete×complete, reschedule×depart, and existing cross-operation/IDOR
  regressions. The process exited normally in about six seconds.

## Phase 8 — Cross-cutting proof and durable recovery

### Shared invariant

Financial truth must be demonstrable after feature tests finish, and a
committed critical state may not depend on one in-process event delivery. The
proof is bounded, repeatable, read-only, and fails on persisted violations
rather than trusting HTTP status or mocks.

### Implementation and verification record — 2026-08-17

- A late-success proof starts with a persisted `PROCESSING` payment carrying
  the unknown-provider-outcome marker, applies the verified webhook on real
  PostgreSQL, and proves one settlement and one technician earning. A second
  provider event for the same payment is `IGNORED` with no second ledger effect.
- Prepaid order settlement and schedule-slot release retain their immediate
  listeners, but each now has a bounded PostgreSQL recovery sweep. Both reuse
  the existing idempotent/locked primitive and are safe across app instances.
- `infra/migrations/check-script1-invariants.js` is a read-only post-integration
  gate. It checks ledger arithmetic, reserved balances, refund totals/effects,
  earning/referral/payout/adjustment ledger links, and additional-work batch
  attribution; any sample violation exits non-zero.
- `docs/14-script-1-final-financial-proof.md` maps scenarios A-J to real test
  evidence and records durability, audit, security, performance, error
  semantics, client compatibility, and external-test limitations.
- Recovery tests passed on real PostgreSQL: two simultaneous prepaid sweeps
  create one settlement/history effect, and a booked slot whose cancellation
  event was missed is released from durable order state. The listener unit
  proof also passes, and Jest exits normally under `--detectOpenHandles`.
- The final bounded matrix passed 17 suites and 81 tests on PostgreSQL TEST;
  the API build passed, all migrations through `0118` had matching checksums,
  and the nine invariant queries passed after fixture cleanup. Repository lint
  could not start because the workspace does not install an `eslint` binary.

### Pull-request review hardening — 2026-08-17

- Stale webhook rows that have already exhausted their retry budget now move
  from `PROCESSING` to the explicit terminal `MANUAL_REVIEW` state. Recovery
  clears the abandoned ownership marker instead of repeatedly selecting an
  event that can no longer be claimed.
- Base-order payment confirmation stores an `effects` checkpoint and its
  replay payload in the webhook row inside the same transaction as financial
  settlement. If post-commit delivery fails, recovery claims only the effects
  stage; it never repeats payment settlement, earning creation, or ledger
  writes. A delivered timestamp makes concurrent/repeated recovery idempotent.
- Refund Phase C now locks and rereads the order before recomputing aggregate
  payment state. Concurrent full refunds against different payments therefore
  cannot lose the final `REFUNDED` order transition or duplicate the earning
  reversal.
- `RefundType.FULL` describes one refund row whose amount equals the payment's
  original amount. A later refund that merely clears the remaining balance is
  `PARTIAL`; payment and order status still become `REFUNDED` when cumulative
  completed refunds equal the payment/order total.
- Migration `0119_webhook_resumable_effects.sql` adds the manual-review enum
  value and durable webhook effects checkpoint. PostgreSQL regressions cover
  exhausted stale recovery, failed post-commit delivery, two-payment refund
  concurrency, and the refund-type rule.
- The final branch-wide Script 1 matrix passed 26 suites and 132 tests under
  `--detectOpenHandles`. Two older order suites were updated to release their
  Phase 7 technician/schedule fixtures after each case and to destroy Redis and
  PostgreSQL in `finally`; this removed the reproduced `TCPWRAP` Jest hang.
- The migration runner verified matching checksums through `0119`, and all nine
  read-only Script 1 financial invariant queries passed after test cleanup.
