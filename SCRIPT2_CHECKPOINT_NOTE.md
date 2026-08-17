# Script 2 Checkpoint — NOT FULLY REVIEWED

This checkpoint was created because the Codex usage limit was reached unexpectedly.

Important:
- The latest Script 2 changes are intentionally preserved.
- This latest batch was NOT fully reviewed end-to-end.
- Do NOT assume the current state is production-ready.
- Review the diff from the previous verified Script 2 commit before continuing.
- Re-run PostgreSQL/Redis integration tests, concurrency tests, migrations/checksums, build, TypeScript, and open-handle checks.
- Pay special attention to the latest Phase C/D work:
  - recurring-order occurrence claims/recovery
  - matching recovery
  - assistant-matching recovery
  - chat recovery
  - background worker invariants/timers
  - refund/reconciliation recovery
- Preserve all verified Script 1 work.
- Continue only on:
  codex/script-2-security-release-hardening
- Do not modify or merge main directly.

Status at interruption:
- Usage limit ended during active implementation.
- Some of the latest changes may be incomplete or only partially tested.
- The next agent should REVIEW FIRST, then continue from this exact branch state.
