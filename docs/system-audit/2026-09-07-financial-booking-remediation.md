# Financial and Booking Remediation

## Applied changes

- Inspection-then-quote approvals charge only the remaining amount after an approved assessment-fee credit. The customer web approval endpoint and payment choice use the same API contract.
- A cancelled prepaid order refunds every eligible successful payment, not just the most recent one. The order remains `partially_refunded` until the full eligible amount is returned.
- The earnings policy has one admin-facing model: a platform commission percentage per service. The rate is copied to `orders.commission_rate_applied` at booking time and is used for settlement, so later catalog edits never alter historical money.
- Fixed-commission cutover controls and V1/V2 comparison UI are removed from the earnings-policy page. Database migrations 0280-0282 replace the fixed-commission constraints with percentage-settlement invariants and enable the unified policy for new orders.
- Customer problem photos are visible in the technician order view before execution starts.
- Duration labels use a 10-hour workday: up to 10 hours is shown in hours; longer work is rounded up to working days. Scheduling continues to use exact minutes.
- Near-term automatic matching defaults to the top four eligible candidates, while remaining configurable in settings.
- Pricing conditions for multi-select fields now match an individual selected value instead of comparing the entire comma-separated storage value.

## Verification performed

- Database migrations through `0283_default_matching_batch_to_four.sql` applied successfully on the local database.
- Focused API regression suite: 54 passing tests covering quote approvals, percentage earnings snapshots, cancellation refunds, and formula evaluation.
- API production build passed.
- Admin TypeScript check passed.
- Customer and technician Flutter analysis passed for the changed screens.

## Operational notes

- Deploy the API only after applying migrations 0280 through 0283.
- Existing historical orders retain their historical status. New orders use the percentage policy automatically.
- The production Nest module must continue to provide `EarningsPolicyService`; it is required to write auditable per-worker earning shares during settlement.
