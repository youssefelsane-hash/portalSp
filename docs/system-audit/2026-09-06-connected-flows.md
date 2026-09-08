# Connected flows audit - 2026-09-06

Baseline: `main @ 23c9d33b` (includes ADR-0077 hourly scheduling).

## Acceptance matrix

| Slice | Evidence / current behavior | Acceptance | Status |
|---|---|---|---|
| Additional scheduled job | `matching.service.ts:1212` creates one work opportunity; existing request route supports atomic accept and parallel broadcast | Same-day workload requires a normal request; automatic matching broadcasts a configurable batch; selected provider stays exclusive; no overlap or capacity bypass | BUG |
| Hourly availability | ADR-0077, `hourly-schedule-blocking.spec.ts` | Different hours available; overlap rejected; multi-day load preserved | UNVERIFIED |
| Assessment/payment | Recent fixes in `6df02ff2`, `ffc773b8`; existing booking audit script and payment/quote specs | Accepted quote has usable provider-selection UI; fees/deposits/delta/refunds reconcile through central services | UNVERIFIED |
| Company branches | `company_repository.dart` supports branch_id on create; screen never supplies it; update is not exposed | Create/update branch and assign/move staff from UI using existing permission-checked API | GAP |
| Company dashboard | `company_screen.dart:50` converts fetch errors to empty orders; four fixed-width stats; ListTile trailing can overflow | Error/retry distinct from empty; responsive cards; meaningful loaded-window metrics and statuses | BUG |
| Settings | Settings registry, seed, generic admin settings | Any new runtime setting appears with documented default and bounds | UNVERIFIED |

No user data cleanup is part of this task. Existing package lock and platform-generated files remain owned by the local checkout.

## Matching verification

41 tests passed across hourly scheduling, parallel first-accept-wins, explicit selected-provider
viewed/retry, mobile signup parity, legacy opportunities, matching and admin explainability.
API TypeScript/Nest build and full ESLint passed. Full initial suite: 1788 passed / 57 failed;
baseline checkout of 23c9d33b on the isolated database reproduced 46 existing booking fixture
failures (plus a settings-registry difference caused by the added migration). Legacy tests
expecting newly-created work opportunities were updated to assert requests; legacy decision
coverage remains. This is not evidence that the entire system is production-ready.

## Implementation order

1. Scheduled request routing and same-source admin explanation, regressions and push.
2. Company membership/branch controls and responsive workspace, verification and push.
3. Booking, quote/payment/refund and settings regressions; record actual results and unresolved limits.
