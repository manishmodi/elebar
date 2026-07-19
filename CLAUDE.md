# Sherpa Mobility ERP — dev notes

Fleet-management ERP for Sherpa Mobility (EV scooter fleet on the Yango
ride-hailing platform): riders (KYC), vehicles, assignments, guard-verified
attendance handovers, daily ride logs, cash reconciliation, two-track payroll
(legacy daily-rate + Variable Pay Engine), performance analytics.

**Read first, every session:** `.claude/context.md` — project memory: decisions,
target architecture, current gaps. Keep it updated.
`COMMANDS.md` holds the dev/release/server runbook (deploy steps, gotchas).

## Layout
- `backend/` Django 5 + DRF. Apps under `apps/`:
  - `common` — UuidMixin/TimeStamped/SoftDelete bases, cursor pagination,
    error envelope, storage upload/download views.
  - `authz` — section catalogue + deny-by-default DRF permission classes.
  - `accounts` — custom `User` (email login), per-user `SectionPermission`
    matrix, JWT auth endpoints, `ActivityLog` audit trail.
  - `riders` — Rider KYC + stats.
  - `fleet` — Vehicle (auto `V-###`), Assignment, Maintenance, ServiceHistory,
    servicing status board (2000 km interval / 1500 due-soon).
  - `operations` — DailyLog, Attendance (guard shift-log), CashCollection
    (denominations + approval), FleetHandover (rider-app staging), dashboards,
    performance analytics, Yango adapter.
  - `payroll` — SalaryAdvance/Payment, PayConfig (effective-dated), PayRecord,
    Streak, Expense(+Category); `engine.py` (VPE) and `salary.py` (salary run).
- `frontend/` Vite + React 18 + TS, hand-rolled CSS in `src/styles.css`,
  react-query, JWT client. Proxies `/api` to :8000.
- The legacy TypeScript stack (Express/Drizzle, formerly `artifacts/` +
  `lib/`) was removed from the tree 2026-07-19; consult git history
  (commit 2667766) when porting the remaining features.

## Workflow phases (do not auto-chain)
- **development** (default) — write code; sanity = `manage.py check` +
  `npx tsc --noEmit`. Do NOT run pytest/review/qa unprompted.
- **review** / **test** / **qa** — only when the user says so; work the queue in
  `.claude/pending/{review,tests,qa}.md`, check items off, leave it clean.
- Infra work uses `.claude/pending/deployment.md` (opt-in infra agents only).

## API conventions (do not regress)
- **Public identifiers are UUIDs.** Integer PKs never appear in URLs or
  payloads. Models inherit `apps.common.models.UuidMixin`; serializers expose
  `id = UUIDField(source="uuid")`; URLs use `<uuid:...>`; FK writes use
  `apps.common.serializers.UuidRelatedField`.
- **Deny-by-default**: DRF's default permission class denies everything. Every
  view declares `section = Section.X` + `SectionPermission` (action derived
  from HTTP method; override via `section_action_overrides`), or `IsAdmin`,
  or explicit `AllowAny` (login/refresh only).
- ViewSet lists are paginated ({count,next,previous,results}); reporting
  APIViews return plain JSON. All money is Decimal (never float), serialized
  as strings. Dates are `YYYY-MM-DD`; Nepali BS dates ride along as text.
- **List filtering is via URL query parameters only** (`?status=`, `?search=`,
  `?date_from=`/`?date_to=`, `?rider=<uuid>`, `?vehicle=<uuid>`) — never
  request bodies, never custom headers. New list endpoints follow the same
  parameter names.

## Domain invariants (do not regress)
- One row per rider-day in daily_logs / attendance / cash_collections; one
  ACTIVE assignment per rider and per vehicle — all DB constraints.
- Riders/vehicles with linked records are never hard-deleted (409 → set
  status inactive).
- Payroll only reads **confirmed** (non-draft) daily logs. VPE pay locks when
  finance **approves the day's cash collection**; recomputes preserve the
  originally-awarded streak bonus; every parameter change is a new
  effective-dated `PayConfig` row (never edit old rows).
- Attendance guard-log fields freeze once the day is closed (verified
  check-in); only admins may correct them, and corrections recompute pay.
- Working days exclude Saturdays (Nepal). Storage is UTC; `ORG_TIMEZONE`
  (Asia/Kathmandu) is the reporting zone.
- **Celery broker is RabbitMQ; Redis is cache-only** (never a broker). Dev
  without RabbitMQ sets `CELERY_TASK_ALWAYS_EAGER=1`.
- Yango (and any provider) integration stays inactive until credentials exist
  in env — dev traffic must never hit live APIs.

## Running locally
- Backend: `cd backend && .venv/bin/python manage.py runserver` (Python 3.12
  venv at `backend/.venv`; SQLite fallback when no DATABASE_URL).
- Frontend: `cd frontend && npm run dev` — system node is v9 (broken); use
  `PATH=/Users/manish/.nvm/versions/node/v24.0.2/bin:$PATH`.
- Datastores: `docker compose -f docker-compose.dev.yml up -d`.
- Seed: `.venv/bin/python manage.py seed_demo`
  (admin@sherpamobility.com / Admin@12345, guard@sherpamobility.com / Guard@12345).
- Tests (test phase only): `cd backend && .venv/bin/pytest` — hermetic
  `sherpa/settings_test.py` (SQLite in-memory, locmem cache, eager Celery).
