# Pricing Defaults: Verification

Date: 2026-09-29. Baseline: `main@54786da1` plus this working-tree change.
Scope: Backend/API + Admin only. No mobile source changes, mobile builds, Play uploads,
database migration, production data changes or production deployment.

## Result

- Admin loads the saved `default_value`, preserves numeric zero, and submits create/update.
- Clearing the input sends `null`, removing the previously saved default.
- Optional omitted slider resolves explicit default, otherwise `min_value`, otherwise zero.
- Explicit input always wins (including zero); required fields still reject missing input.
- Numeric defaults outside min/max or not finite are rejected before create/update writes.
  Partial updates validate the merged settings. Legacy invalid defaults still fail evaluation.
- Number fields still have no implicit min/zero fallback. Checkbox behavior is unchanged.
- Existing formula AST, pricing snapshots, endpoints, permissions and client payloads are unchanged.

## Tests Executed

| Check | Observed result |
| --- | --- |
| API pricing module, real isolated Postgres | 19 suites, 200 tests passed |
| New slider/default integration coverage | 21 tests passed |
| Admin unit tests | 18 passed, including 8 new default-input checks |
| API TypeScript | Passed |
| API ESLint, all src, zero warnings | Passed |
| API production compilation | Passed |
| Admin TypeScript | Passed |
| Admin changed-source lint | Passed |
| Admin production build | Passed, 78 static pages generated |
| Real browser -> Admin -> API -> DB | Passed (details below) |
| Full API regression | 2559 passed, 2 pre-existing failures; no new failing tests |

Full-suite failures match the saved pre-change audit by exact test name:

1. `security/workforce-activity.spec.ts`: old short idle-threshold expectation conflicts with
   the current five-minute heartbeat policy. Same failure before this change.
2. `settings/settings-registry.spec.ts`: `orders.require_phone_verification_on_first_order`
   is registered but not seeded. Same missing key before this change.

These unrelated failures were not hidden, disabled or changed. This is not a claim that the
entire application has passed all production-readiness gates.

## Browser and HTTP Evidence

The reproducible script is `apps/admin/test/pricing-field-default.e2e.mjs`.
It uses disposable local accounts, actual PIN login and a virtual WebAuthn authenticator,
the built Admin UI, the compiled API and isolated Postgres/Redis. No network response mocks.

1. Created number with min=0/max=100/default=0 through the UI; reopened and confirmed zero.
2. Created optional slider with min=0/max=10/default=3; page reload retained the value.
3. Default=11 was blocked by the form without overwriting the saved value.
4. Clearing default through the UI persisted null.
5. Public evaluate-price with omitted slider returned 0; explicit 5 returned 1000 cents.
6. Updating default back to 3 returned 600 cents for omitted input, still 1000 for explicit 5.
7. Direct API attempt default=11 returned HTTP 400 with an explicit default-value error;
   subsequent evaluation still used the previous valid default.
8. Desktop form layout inspected; no browser page errors. At 390px the existing Admin
   sidebar squeezes the whole page. That pre-existing layout limitation is not fixed or
   counted as a responsive-page pass; this task does not change the sidebar or mobile apps.

The five-slider ironing formula is also covered by a real-DB integration test: all omitted
inputs evaluate to zero; shirts=5/jackets=2 produce 1500 cents in both preview and live
evaluation, with omitted fields stored as zero in the evaluation snapshot.

Initial test-harness issues were corrected before the successful runs: the new DB fixture
needed category `name_en`, and the public POST evaluation endpoint returns 201 (not 200).
Neither required a production-code change.

## Reproduction and Deployment

Use a disposable migrated test DB via `DATABASE_URL` and an isolated Redis. With that env:

```sh
npm --prefix apps/api test -- --runInBand --testPathPattern=modules/pricing
npm --prefix apps/admin run test:unit
```

For browser verification run the built API and Admin against the same local test services,
set `API_BASE_URL`/`API_URL`/`NEXT_PUBLIC_API_URL` consistently, set `ADMIN_URL` equal to
`WEBAUTHN_ORIGIN`, and run `node apps/admin/test/pricing-field-default.e2e.mjs`.
The script rejects non-local URLs and non-test DB names.

Deploy API and Admin only with the existing deployment procedure. No migration or customer/
technician application rebuild is required. The new default is a server-side calculation;
it does not visually prefill text fields in already-installed apps. No real-device Play
binary or production server was exercised in this bounded change.
