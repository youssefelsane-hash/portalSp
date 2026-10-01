# Admin orders search and filters — 2026-10-01

Baseline: `origin/main` at `830701a71bce5bb4a076de7a60da369d5eab77d5`.

## Execution map

1. `/orders` keeps scope, search, date field/range, bucket, status, payment, service, zone, origin, crew, sort, view, and page in the URL.
2. The page sends the same filter parameters to `/admin/orders`, `/admin/orders/summary`, and `/admin/orders/calendar`.
3. `ListOrdersQueryDto` validates parameters; `AdminOrdersService.buildOrdersFilter()` is the shared predicate for all three responses.
4. Existing Postgres tests cover order-number search, customer/technician/Payment ID search, visibility, and list ordering.

## Acceptance matrix

| Behavior | Current evidence | Target / proof |
|---|---|---|
| Order number, names, phone, Payment ID | Existing search suite | Re-run on migrated test DB |
| Scope, status, payment, service, zone, origin, crew | Code path exists, mixed coverage | Exercise representative combinations on test DB |
| Date field and custom range | `new Date('YYYY-MM-DD')` interpreted as UTC midnight | Cairo calendar days inclusive, tested at day boundaries |
| Presets and buckets | UI has presets, backend has Cairo buckets | Verify preset day count and avoid conflicting bucket/date filters |
| Summary/calendar parity | Shared predicate | Compare aggregates and list for same filters |
| Deployment scope | Admin/API only | No mobile files or migrations changed |

## Confirmed fixes

- Date-only `from` and `to` now cover Cairo calendar days. Explicit ISO instants keep their original exact-bound semantics.
- `sort=soonest` now uses the mapped entity property, avoiding a TypeORM pagination error.
- The calendar groups by the selected date field, so clicking a displayed day filters the same day.
- The `next7` bucket and the 7/30-day presets include today as day one. Presets use Cairo's date, not the browser's UTC date.
- A custom range clears an active bucket; incomplete or manually entered ranges display as custom. Selecting completion date from the default current scope switches to completed.
- Submitting a search switches to all orders so old order numbers are discoverable; other explicit filters remain available.

## Verification

- `admin-orders-filters.spec.ts`: 7 tests passed on a fresh migrated Postgres database. Covers full/partial order number, scope/status/payment/service/zone/recurrence/crew, Cairo day edges, alternate date fields, list/summary/calendar parity, exact ISO bounds, pagination sort, and all operating buckets.
- Existing `admin-orders-search.spec.ts`, `admin-orders-visibility.spec.ts`, and `admin-orders-list-ordering.spec.ts` passed in the full API suite.
- Admin date-range unit tests passed, along with the full admin unit suite (34 tests), typecheck, targeted lint, and Next production build.
- Full API checks passed: TypeScript, ESLint, Nest build, and Jest (400 suites, 2671 tests) against Postgres/Redis test containers.
- This was a local test deployment only; no production admin session or production data was exercised. Only API/Admin source changed; no migrations or mobile app changes.
