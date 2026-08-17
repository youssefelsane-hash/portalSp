# Script 1 Final Financial Proof

## Scope

This report closes Script 1 sections 58-75. It records persisted outcomes, not
only successful responses. PostgreSQL is real local TEST infrastructure;
Redis is real where a tested flow uses it. Provider HTTP calls use controlled
provider boundaries so no customer or sandbox charge is created accidentally.

Run the post-suite invariant gate with:

```bash
DATABASE_URL=postgres://... npm --workspace @baytak/migrations run check:script1
```

The gate is read-only and exits non-zero when it finds a violation.

## Final Scenarios

| Scenario | Automated evidence | Persisted proof |
| --- | --- | --- |
| A — payment timeout | `payments.provider-outcome.spec.ts`, `cash-settlement-direction.spec.ts` | Timeout remains `PROCESSING`; late success becomes `SUCCEEDED`, settles once, and a second event is ignored. |
| B — additional-work refund | `cash-settlement-direction.spec.ts`, `refund-transaction-safety.spec.ts` | Refunding only the 2,000 component leaves the base component paid and reverses only its proportional earning allocation. |
| C — earning double approve | `domestic-worker-earning-approval.spec.ts` | One approval, one double entry, one balance increase. |
| D — complaint double resolve | `complaint-decision-concurrency.spec.ts` | One terminal complaint decision and at most one compensation double entry. |
| E — referral duplicate qualification | `referral-integrity.spec.ts`, `technician-referral-financial-integrity.spec.ts` | Unique source/milestone records and one wallet or promo effect. |
| F — technician double acquisition | `matching-accept-concurrency.spec.ts` | One active assignment for one technician, enforced again by a partial unique index. |
| G — webhook crash | `webhook-amount-verification.spec.ts`, `webhook-recovery.service.spec.ts` | Failed/stale event stays recoverable; retry processes one provider-scoped event once. |
| H — wallet refund crash | `refund-transaction-safety.spec.ts` | Refund remains `PROCESSING`; it cannot appear `COMPLETED` before the wallet credit commits. |
| I — wallet adjustment retry | `wallet-manual-adjustment.spec.ts` | One source row and one double entry for a repeated idempotency key. |
| J — multiple partial refunds | `refund-transaction-safety.spec.ts` | Both legitimate partial rows persist and reserved/completed sum never exceeds the payment. |

## Durable Effects

Critical truth is stored before or with its effect:

- Payments, refunds, payouts, wallet adjustments, earnings, complaint
  compensation, and referral bonuses commit source state with their local
  financial effect or retain a recoverable non-terminal state.
- Webhooks and standard referrals have bounded database recovery sweeps.
- Prepaid settlement and schedule release now have bounded database sweeps in
  addition to immediate `EventEmitter` listeners.
- Matching round jobs use stable job IDs after enqueue. If initial dispatch is
  missed, order timeout/auto-cancel preserves financial truth and refunds a
  prepaid order; complete event-to-queue outbox coverage remains Script 2.

Notifications, WebSocket updates, and derived technician statistics are best
effort. Their loss does not alter ledger, payment, assignment, or order truth.

## Audit And Security

Human-sensitive paths retain actor, resource, before/after state, reason, and
financial amount in the existing audit log: refunds, payout decisions, earning
decisions, wallet adjustments, complaint decisions, admin reassignment, and
manual payment confirmation. Automated rewards retain durable source rows and
ledger references rather than pretending to be human audit actions.

Controllers continue to enforce authentication, role, exact permission,
ownership where applicable, DTO amount validation, and existing MFA step-up
policy. No RBAC was weakened. Request IDs flow through response envelopes and
audit metadata; payment/order/provider/job IDs provide operation correlation.
No OTP, token, provider credential, `.env`, or private document is logged or
included in this change.

Expected races return existing domain conflicts. Schedule exclusion violations
are translated from PostgreSQL `23P01`; assignment races are serialized before
the unique constraint is reached. The shared error envelope and response DTOs
remain compatible with current clients, so no UX redesign is introduced.

## Database And Performance

Migrations were preflighted against existing TEST data. The migration runner
verifies immutable SHA-256 checksums, and migration `0118` is recorded with a
matching checksum. Locks are scoped to order, technician, payout, wallet, or
business-source rows. Recovery scans use indexed predicates and batches of 25;
there are no global locks, unbounded retries, or per-row retry queues.

The post-suite invariant gate verifies:

- wallet arithmetic and non-negative reserved balances;
- cumulative refund bounds and a real effect for every completed refund;
- earning, referral, payout, and adjustment ledger linkage;
- additional-work payment attribution to a batch on the same order.

## Known Limitations

- No real Paymob/Fawry charge or refund was issued. Provider signature/parsing
  tests and local settlement use controlled provider responses.
- A provider refund stuck in `PROCESSING` still requires provider-supported
  reconciliation/manual review; the provider contract cannot safely infer an
  external refund result without a provider reference lookup.
- A complete transactional outbox for every notification and workflow event is
  intentionally deferred to Script 2. Script 1 critical financial truth is
  atomic or recoverable, and best-effort delivery does not mutate that truth.
- Admin frontend dependencies are absent in this workspace, so its full Next.js
  build cannot run here. API build/typecheck and changed backend tests are the
  authoritative verification for this phase.

## Completion Report

**Phase:** Cross-cutting integrity proof and durable recovery.

**Findings covered:** Script 1 sections 58-75 and scenarios A-J.

**Root cause:** Strong individual fixes lacked one repeatable invariant gate,
one end-to-end late-payment proof, and recovery for two critical in-process
listeners.

**Existing code reused:** Row locks, state machines, wallet double entry,
provider-scoped webhook claims, recovery sweep pattern, audit infrastructure,
request IDs, and migration checksum runner.

**Idempotency and recovery:** Source uniqueness plus locked rereads; bounded
PostgreSQL sweeps reconstruct missed listener work.

**Final DB state verified:** Yes, by integration assertions and the invariant
gate after fixture cleanup.

**Temporary data cleaned:** Yes.

**Final automated verification:** 17 suites / 81 tests passed with
`--detectOpenHandles`; API build passed; migrations `0001`-`0118` and all nine
post-suite invariants passed. Lint was unavailable because no `eslint`
executable is installed in this workspace.

**Status:** `VERIFIED DONE`, subject to the explicit external-provider and
frontend dependency limitations above.
