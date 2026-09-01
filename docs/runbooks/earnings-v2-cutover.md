# Earnings V2 cutover and rollback

## Preconditions

1. Apply migrations `0227` and `0228` in order.
2. Open **Admin > Earnings Policy Center** and configure a fixed EGP commission for every active service.
3. Confirm readiness is 100% and shadow comparison is collecting completed V1 orders.
4. Review shadow deltas with Finance; test cash, online, deposit, team, partial refund, and full refund.
5. Take a database backup and record the deployment version.

## Enable

1. A finance or super-admin user with MFA opens the Earnings Policy Center.
2. Select **Enable V2 safely** and provide the cutover reason.
3. Create one low-value test order and confirm `settlement_policy_version = 2` and a non-null fixed
   commission snapshot.
4. Complete it and verify platform commission plus participant shares equals the order total.
5. Verify wallet entries, technician statement, admin breakdown, KPI, and refund reversal records.

## Monitoring

- Alert on failed settlement transactions and database constraint violations.
- Reconcile daily: V2 order total against platform commission plus earning shares.
- Reconcile refunds against `refund_settlement_reversals`.
- Never repair a mismatch by editing wallet balances or historical shares directly.

## Rollback

Disable V2 in the Earnings Policy Center. This affects only orders created afterward. Existing V2
orders must continue through the V2 calculator using their immutable snapshots. Do not rewrite their
policy version and do not restore percentage commission logic for them.

## Incident response

If an invariant fails, stop new V2 order creation, preserve the affected rows and logs, and escalate to
Finance and Engineering. Repair the source transaction through an audited compensating ledger entry;
never delete or mutate settled financial history.

