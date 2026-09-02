# ADR-0063: Unified booking assessment, quote versions, and price lock

## Status

Accepted for incremental implementation. This ADR extends the existing pricing, order,
matching, payment, and notification domains. It does not introduce a second pricing engine.

## Problem

The current system can calculate an exact candidate price, but an automatically matched
technician is selected only after the order is created. A manually requested technician is
also a preference that later matching rounds may silently replace. The remote-photo quote
flow moves directly from customer quote approval to technician search. These behaviours can
change either the provider or the price after the customer's last confirmation.

The inspection quote is also stored directly on `orders.estimated_price_cents`. Re-submitting
a quote overwrites business history, so expiry, revisions, concurrent decisions, and explicit
approval cannot be represented reliably.

## Decision

### One booking contract

The customer completes all price- and availability-affecting inputs before provider selection.
The final step always uses a server-issued match preview. The preview contains the chosen
candidate, the complete pricing snapshot, a deterministic context hash, and an expiry time.
Order creation consumes this preview exactly once after revalidating ownership, context,
candidate availability, and price. A stale preview returns a conflict; it never substitutes a
different technician silently.

### Separate price lifecycle from order lifecycle

`orders.price_status` records whether price is confirmed, provisional, awaiting assessment,
awaiting a quote, awaiting customer approval, or locked. Order states continue to describe
operational lifecycle. Only one operational state is added: `awaiting_technician_selection`,
used when a remote quote has been approved but the customer has not confirmed an executor.

### Service policy and historical snapshots

`services.price_certainty_mode` controls whether a service has a confirmed price, an estimated
range, or requires assessment. Assessment routing and fee/credit/expiry rules are configured on
the service. Every order snapshots the applied policy so later admin changes do not rewrite
historical financial meaning.

Existing formula services default to `confirmed_price`. Existing `inspection_then_quote`
services default to `assessment_required` and `admin_triage`. Existing
`inspection_fee_cents` remains the on-site fee; it is not duplicated.

### Versioned quotes

Every base-price assessment or diagnosis revision creates an immutable row in `order_quotes`.
Only status/decision columns on that version may change. `(order_id, version)` is unique and a
partial unique index allows only one live quote per order. Customer approval records the user,
time, and exact amount/version. Additional work remains in the existing `order_items` subsystem.

### Price range semantics

Customer-facing estimated range fields are separate from `min_price_cents` and
`max_price_cents`, which remain pricing clamps. Range snapshots may later be produced by the
formula engine; static service fields are only the fallback.

## Invariants

1. No amount enters the order total without an explicit customer approval for that amount.
2. Preview card price, confirm button price, and persisted order price come from one backend
   pricing snapshot.
3. A preview cannot be consumed twice and cannot be consumed after its context changes.
4. Remote quote approval never dispatches directly; it waits for final provider selection.
5. On-site quotes do not apply the technician-level multiplier a second time.
6. Quote approval and financial finalization run under a pessimistic order lock.
7. Emergency surcharge remains in internal snapshots but is not a separate customer-facing row.
8. `order_items` remains the only source for additional work during execution.

## Delivery slices

1. Schema, entities, state and contracts.
2. Versioned remote/on-site quote service and admin triage.
3. Match preview creation/consumption and exact-provider dispatch.
4. Admin, customer web, customer Flutter, and technician Flutter UI.
5. Notifications, realtime, audit, permissions, and regression/concurrency tests.

