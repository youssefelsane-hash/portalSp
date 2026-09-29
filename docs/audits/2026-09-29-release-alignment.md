# Release alignment, 2026-09-29

## Request and baseline

Build customer and technician Play bundles and test APKs from the latest main,
repair the blank admin tracking map, and provide a matching server update command.
Baseline: `be535155` (PR #382), fast-forwarded without touching pre-existing local
Flutter lockfile, Swift package, iOS backup, or scenario-report changes.

## Execution map and reproduced cause

- `/operations/live-map` reads the authenticated operations snapshot successfully.
- `OperationsLiveMap` imports Leaflet asynchronously and uses `lib/map-tiles.ts`.
- The deployed page returned three technicians and eight orders, but its console
  reported missing `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` on 2026-09-29.
- Next public variables are captured at build time; a systemd restart cannot add
  a missing token to an already-built browser bundle.
- Missing token returned after creating a map, without registering cleanup.
  Initial marker rendering also raced asynchronous Leaflet initialization.
- Mobile releases use `scripts/build-play-release.sh`, signed per-app Android
  inputs and the production API define, then inspect the compiled artifact.

## Acceptance matrix

| Check | Evidence required | Status |
| --- | --- | --- |
| Latest upstream preserved | Fast-forward main and review diff | Passed |
| Blank map root cause | Production browser console, read-only | Reproduced |
| Missing map token | OSM fallback, attribution and Referer; no blank map | Passed automated checks and one real-tile browser viewport |
| Map initialization | First markers, updates, cleanup, resize | Passed, including StrictMode remount |
| Tile failure | Visible error and retry, no crash | Passed with mocked HTTP 503 and recovery |
| API/admin/web regression | Tests, type checks, lint, production builds | Passed; counts below |
| Both Android identities | Package, version, icon and signature from outputs | Passed local artifact inspection |
| Production API embedded | Inspect both AAB/APK binaries | Passed, all four artifacts |
| Actual device startup | Connected device/emulator if available | Not run: adb reports no connected device |
| External services | Read-only production health and browser observations | Partial: API/database/admin/web and real OSM tiles passed |
| Server parity | Pinned tested commit, migrations, build and health gates | Script tested in isolated simulation; not executed on VPS |

## Scope and limitations

No production orders/payments or user data will be modified. Public OSM tiles
are a keyless fallback for interactive admin views, not a bulk/offline download
service or an availability guarantee. Mapbox remains preferred when configured.
The fallback retains visible attribution and browser cache/Referer behavior per
https://operations.osmfoundation.org/policies/tiles/ .

Production payment-provider transactions, push delivery and device-specific Maps
authorization need actual sandbox/device credentials and are not inferred from a
successful compile. Final results are appended as each check completes.

## Completed verification (2026-09-30 Cairo)

- Latest upstream checked again: `be535155d56ec8711d6806adbf364d3037e239db`.
- API: **391 suites / 2594 tests passed**, ESLint and Nest production build passed.
  PostgreSQL and Redis were real local test services, not production.
- Admin: **32 unit tests passed**; actual map component browser regression passed
  initial markers, data refresh, remount, resize, tile-error visibility and retry.
  Type checking, ESLint and production webpack build passed.
- Customer web: **21 tests passed**, ESLint/type checking/production webpack build passed.
- Customer Flutter: **250 tests passed**, analyzer clean.
- Technician Flutter: **91 tests passed**, analyzer clean.
- Release-readiness check: **14/14 passed**. Database migration numbering and
  hygiene passed: no missing FK indexes, duplicate indexes or orphan enums.
- Server deployment simulation: successful activation, pre-stop build failure,
  and post-stop health failure all passed; private env files preserved, prior
  build/dependencies restored on failed activation. Bash syntax passed.
- Production read-only: API health HTTP 200 with `status=ok`, `database=up`;
  admin login and public web HTTP 200. Operations page showed zero recent 5xx,
  zero recent frontend errors and zero failed queue jobs at inspection time.
- Manual local browser: actual Cairo OSM street tiles, technician/order markers
  and attribution rendered. Automated tests use mocked tiles, not public bulk requests.

## Additional issues repaired

The admin production build rejected an unsupported route-module export
(`BUCKET_LABELS` in `risk-center/page.tsx`). The unchanged labels now live in
`lib/risk-labels.ts`, shared by the list and detail pages.

One payment integration test failed intermittently because a second settings
notification from its preceding test was still running. Waiting for both reload
promises fixed the test isolation; no payment runtime logic was changed.

## Mobile release identity

Both apps are **1.0.10+11**, built with Flutter 3.44.9 / Dart 3.12.2 and
`API_BASE_URL=https://api.ostahome.com/api/v1`. The release script inspected
compiled arm64 code in all AAB/APK files: production URL present, emulator URL absent.

| App | Package | Launcher label | Icon |
| --- | --- | --- | --- |
| Customer | `com.ostahome.customer` | أسطى - Osta | Approved orange house |
| Technician | `com.ostahome.technician` | أسطى فني - Osta | Approved blue house |

Actual APK resources were extracted and decoded pixels matched each app's source
launcher icon. The customer lockfile's four pre-existing SDK-constrained resolutions
are retained in this release to reproduce the tested Flutter SDK dependencies.
Other pre-existing Swift/iOS backup and prior-audit artifacts remain untouched.

Upload-key SHA-256 fingerprints from the AABs:

- Customer: `A6:16:F9:8E:51:F1:E3:64:E2:3D:D4:9B:98:A5:09:64:1F:65:34:6F:5C:CE:45:72:95:B4:A4:21:60:82:93:FA`
- Technician: `93:32:17:69:5E:A2:A8:EB:C9:60:54:7E:DA:1C:4F:C3:40:33:84:8A:66:21:2E:C1:8F:29:98:EE:14:05:DC:CD`

These use the existing local upload keys. Play Console certificate matching,
available version codes, policy approval and rollout eligibility were not verified
in this run. No upload or production deployment was performed automatically.

## Deployment and handoff

`scripts/deploy-osta-release.sh FULL_COMMIT_SHA` runs as root on the existing Ubuntu
VPS, with an `osta` checkout at `/srv/osta/app`. It requires Node 20.9-24 (22 LTS
recommended), PostgreSQL client tools and at least 6 GiB free. It validates the
existing systemd service users/directories, tracked Git cleanliness and ancestry
before proceeding. Unknown service layout fails before stopping anything.

It builds API/admin/web in a private staging directory, imports the existing local
environment configuration (including public build-time variables), backs up the
database and checks its archive, applies migrations, then briefly stops the
services to swap finished outputs. Health checks gate completion. On activation
failure it attempts to restore previous build/dependencies; database migrations
are **not** rolled back and Git stays at the new revision. Backups are retained
under `/srv/osta/backups/`. The script was simulated locally, not run on the VPS.

No guarantee is made for untested real payment-provider transactions, push delivery,
device-specific Google Maps restrictions, actual Android startup, or App Store/iOS
builds. Test the supplied APKs on a device before Play upload. If an existing Play
installation has a different signing certificate, use a separate test device or
Play internal testing rather than automatically deleting user data.

Local detailed build/test logs: `.dev-logs/release-20260929/`.
