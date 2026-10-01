# Academy question editor — 2026-10-01

Baseline: `origin/main` at `830701a71bce5bb4a076de7a60da369d5eab77d5`.

## Execution map

1. Admin `/academy` lists courses but only edits activation. `academy.manage` already protects writes.
2. The API stores `quiz_questions` as JSONB on `academy_courses`; the admin update DTO does not accept it.
3. The technician's `GET /academy/courses` reads that JSONB and strips `correct_index`; `submitAttempt` grades from the same stored questions.
4. Attempts store their score and pass result at submission time, so editing question text must not rewrite historical attempts.
5. The editor will change wording, choice text, and correct choice on existing questions only. Stable question IDs, order, and choice counts keep the current app protocol intact.

## Acceptance matrix

| Behavior | Current | Target | Scope | Proof |
|---|---|---|---|---|
| Admin edits existing prompts and choices | GAP | Save and reload edited wording | API + Admin | API validation and service tests; Admin typecheck |
| Correct answer stays server-only | CONFIRMED_EXISTING | Manage-only editing endpoint; public payload unchanged | API | Serialization and permission tests |
| Invalid or structural quiz edits | GAP | Reject clearly; no partial write | API | DTO and service tests |
| Prior attempts | CONFIRMED_EXISTING | Scores and pass results remain unchanged | API | Regression test |
| Customer/technician release | Not needed | No app source/build change | None | Diff inspection |
| Database schema | CONFIRMED_EXISTING | Reuse JSONB, no migration | None | Diff inspection |

## Verification

- Admin editor loads the stored questions with `academy.manage`, changes text/choices/correct choice, and saves to the existing JSONB column. Public course responses still exclude the answer key.
- Structural changes (question IDs, order/count, option count) and empty/invalid content are rejected before saving. Historical attempt rows are not rewritten; new attempts grade against the current questions.
- `academy-course-edit.spec.ts` (10 tests) and the real-Postgres onboarding integration test passed; the full API suite passed (400 suites, 2671 tests).
- Admin typecheck, lint, unit suite, and production build passed. No schema migration or customer/technician application change is required; the server API and Admin UI must be deployed together.
