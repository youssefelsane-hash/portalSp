# ADR-0058 - Unified Workforce Earnings Engine V2

- **Status:** Accepted
- **Date:** 2026-08-31
- **Supersedes financially:** ADR-0037, ADR-0040, ADR-0043 for newly created V2 orders
- **Preserves:** every V1 order and immutable V1 settlement

## Context

The platform had several overlapping money rules: service percentage commission, level commission
adjustments, weighted crew splits, and a separate fixed assistant wage target. The same order could
therefore be explained differently by the wallet, technician statement, refund path, KPI report, and
admin screens. Technician and assistant are workforce capabilities, not separate ledgers, so this
split architecture could not guarantee that every piaster had one owner and one explanation.

## Decision

All newly cut-over orders use policy version 2:

1. The service has one fixed `platform_commission_cents` amount.
2. Order creation captures that amount in `platform_commission_cents_snapshot`.
3. `worker_pool_cents = total_amount_cents - platform_commission_cents_snapshot`.
4. Every actual participant, technician or assistant, enters one proportional weighted pool.
5. Effective weight is calculated only from immutable integer basis-point factors: career level,
   earning role, approved service skill, individual adjustment, and order adjustment.
6. Largest-remainder rounding distributes the entire pool exactly and deterministically.
7. The settlement writes a complete `order_earning_shares` explanation before wallet effects commit.
8. Refunds reverse the original platform and participant buckets cumulatively; current policy is
   never consulted for an old refund.

The invariant is:

```text
fixed platform commission + sum(participant shares) = final order total
```

No booking mode, promotion, team composition, technician level, company role, or payment method can
change the fixed platform commission. Free warranty revisits create no new commission or earnings.
Daily assistant wages remain planning inputs only and never settle a V2 wallet.

## Workforce semantics

`technician_kind` is the person's permanent capability. `earning_role` is the role performed on one
order. A technician may assist on an order; a permanent assistant cannot lead. Both use the same
career levels and progression. The admin UI displays levels in ascending order with one to five stars
so the career order is unambiguous.

## Ownership and administration

The sole write surface for V2 money policy is **Admin > Earnings Policy Center**. Catalog and ordinary
level configuration retain legacy values as read-only history. Every policy mutation requires a
reason, financial permission, MFA step-up, and an audit entry. Service- and worker-specific overrides
are explicit records, never hidden constants.

## Migration and rollback

V2 remains disabled for new orders until every active service has a fixed commission. Shadow mode
compares V1 and V2 without wallet effects. Cutover changes only new orders; rollback disables new V2
creation while already-created V2 orders continue to settle under their captured snapshot.

Migration `0227` adds the policy and snapshot model. Migration `0228` adds integrity constraints and
explicit super-admin permissions. V1 columns remain solely because deleting them would make historical
orders impossible to reproduce.

## Consequences

- One calculator explains preview, settlement, wallet, refund, progression, KPI, and admin reporting.
- Integer piasters and deterministic tie-breaking prevent rounding drift.
- Participant earnings depend on relative weight; they are not a percentage of gross order value.
- Historical rows never change when an admin updates current policy.
- A V2 paid order with an incomplete or unbalanced snapshot is rejected by the database.

