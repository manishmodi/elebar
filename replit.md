# Elebhar Fleet Management System (EFMS)

## Overview

Full-stack fleet management web app for a Nepali ride-hailing fleet operator ("Elebhar"). Built as a pnpm workspace monorepo using TypeScript. Manages vehicles, riders, assignments, daily operations logs, attendance, maintenance, dashboard KPIs, and reports — all with Nepali Bikram Sambat (BS) calendar support and रू (Nepali Rupees) currency.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 19 + Vite + Tailwind CSS + Recharts + React Query
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API server)
- **Auth**: express-session + connect-pg-simple + bcryptjs
- **File storage**: Replit Object Storage (GCS-backed) — presigned URL upload pattern

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server (port 8080)
│   └── elebhar/            # React+Vite frontend (previewPath: /)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
│   └── src/seed.ts         # Database seed script
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Authentication & Authorization

### Session-based Auth
- Server-side sessions stored in PostgreSQL via `connect-pg-simple`
- Session cookie name: `efms.sid`, 24-hour expiry
- Passwords hashed with bcryptjs (10 rounds)
- `/api/healthz` is always public; `/api/auth/*` endpoints are public; all other routes require authentication

### Role-Based Access Control (RBAC)
- Dynamic per-user permissions via `user_permissions` table
- 13 permission sections: `dashboard`, `daily-logs`, `vehicles`, `riders`, `assignments`, `attendance`, `maintenance`, `financials`, `reports`, `users`, `activity-log`, `archive`, `performance`
- 4 actions per section: `canView`, `canCreate`, `canEdit`, `canDelete`
- Permission middleware: `requirePermission(section, action)` on every data route
- Default admin: `admin@elebhar.com` / `Admin@1234` with full access
- Seed script: `artifacts/api-server/src/seed-admin.ts`

### Auth Flow
- Frontend: `AuthProvider` context wraps app, checks `/api/auth/me` on load
- Login page at `/login`, auto-redirect when unauthenticated
- Sidebar nav filtered by user's `canView` permissions
- User Management page at `/users` for creating/editing users and setting permissions

## Key Business Logic

### Daily Operations Log Fields (matches team spreadsheet)
Nepali Date, English Date, Rider, Vehicle, Check-in/out Time, Daily Bonus Set, Total Rides Received, Rides Completed, Acceptance Rate, Bonus Target Completion, Total Ride Distance (km), Total Ride Hours, Total App Online, Cash as per App (रू), Goal Bonus (रू), Promotion Bonus & Other (रू), Total Income (रू), Cash Given by Driver (रू), Cash Transferred Online (रू), Cash Check (रू), Daily Allowance (रू), Additional Expenses (रू), Remarks

### Calendar
- Data stored as AD dates internally
- BS (Bikram Sambat) dates displayed in UI alongside AD dates
- AD↔BS bidirectional conversion: `adToBS()`, `bsToAD()`, `bsStringToAD()`, `adToBSFormatted()` in `lib/nepali-date.ts`
- DateRangeFilter component supports AD/BS toggle with auto-conversion between calendar systems

### Currency
- Displayed as रू (Nepali Rupees) throughout

## Database Schema (PostgreSQL)

8 tables in `lib/db/src/schema/`:
- `vehicles` — fleet vehicles with status, insurance, battery details
- `riders` — rider profiles with employment type, license, documents
- `assignments` — rider-vehicle assignments with shift types
- `daily_logs` — daily operational metrics matching spreadsheet
- `attendance` — rider attendance with BS date support; `vehicle_override_reason` populated when guard records a vehicle that differs from the rider's active assignment
- `maintenance` — vehicle maintenance records with costs
- `users` — staff accounts with email/password auth
- `user_permissions` — granular per-user permission matrix (section × action)
- `session` — auto-created by connect-pg-simple for session storage

## API Routes (Express, `/api` prefix)

### Auth (public)
- `POST /api/auth/login` — login with email/password, returns user + permissions
- `POST /api/auth/logout` — destroy session
- `GET /api/auth/me` — get current user + permissions

### Data (protected, permission-checked)
- `GET/POST /api/vehicles`, `GET/PUT/DELETE /api/vehicles/:id`
- `GET/POST /api/riders`, `GET/PUT/DELETE /api/riders/:id`
- `GET/POST /api/assignments`, `PUT/DELETE /api/assignments/:id`
- `GET/POST /api/daily-logs`, `PUT/DELETE /api/daily-logs/:id`
- `GET/POST /api/attendance`, `PUT/DELETE /api/attendance/:id`
- `GET/POST /api/maintenance`, `PUT/DELETE /api/maintenance/:id`
- `GET /api/dashboard/summary`, `GET /api/dashboard/rider/:riderId`, `GET /api/dashboard/vehicle/:vehicleId`
- `GET /api/dashboard/fleet-stats?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` — fleet avg daily rides & income over date range
- `GET /api/riders/stats?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` — per-rider avg rides/day & avg revenue/day over date range
- `GET /api/performance?dateFrom=&dateTo=` — per-rider performance summary (tier, attendance, acceptance, hit rate, fraud days, coaching flags)
- `GET /api/performance/rider/:riderId?dateFrom=&dateTo=` — per-day breakdown for a single rider

### User Management (protected, auth-only)
- `GET/POST /api/users`, `PUT/DELETE /api/users/:id`

## Frontend Pages (React Router)

- `/login` — Login page (public)
- `/` — Dashboard with KPIs, weekly income chart, fleet avg daily rides/income KPIs with AD/BS date range filter
- `/daily-logs` — Daily operations log table with all spreadsheet columns + BS auto-conversion
- `/vehicles` — Vehicle fleet management (full form: type, color, battery, insurance, etc.)
- `/riders` — Rider management with per-rider avg rides/day + avg revenue/day stats and AD/BS date range filter
- `/assignments` — Rider-vehicle assignments (duplicate rider/vehicle prevention)
- `/attendance` — Attendance records with BS date auto-conversion
- `/maintenance` — Vehicle maintenance tracking
- `/financials` — Financial Management with revenue charts, cash breakdown, top riders
- `/reports` — Reports & CSV export
- `/performance` — Rider Performance scoreboard with tiers (A+/A/B/C/D), coaching flags (low_acceptance, absentee, volatile, bonus_hunter, cash_discipline, high_earner, fraud_risk), per-rider drawer with charts and Daily Breakdown
- `/users` — User Management with permission matrix UI

### Yango Fraud-Ride Detection (Performance page)
- A daily log day is "evaluable" only if Yango set a target (`dailyBonusSet > 0`) and the rider was present.
- A "Suspect Fraud Day" = `ridesCompleted >= dailyBonusSet` AND `goalBonus` is empty/null/0 — the rider hit the target on paper but Yango paid no goal bonus, indicating Yango's anti-fraud system disqualified rides (self-rides, GPS spoof, fake pickups, etc.). The bonus *amount actually paid* is the source of truth, not the `bonusTargetCompletion` flag (which may be inconsistently recorded by staff).
- Days with null/zero `dailyBonusSet` are excluded from both numerator and denominator.
- The `fraud_risk` flag fires whenever `fraudDays > 0`; it is filterable from the Flag dropdown and rendered with a red ShieldAlert badge on the row, in the drawer "Suspect Fraud Days" stat card, and as a "SUSPECT" pill on the matching row of the Daily Breakdown table.

## Development Commands

- `pnpm install` — install all dependencies
- `pnpm --filter @workspace/api-server run dev` — start API server
- `pnpm --filter @workspace/elebhar run dev` — start frontend
- `pnpm --filter @workspace/scripts run seed` — seed database
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API types
- `pnpm --filter @workspace/db run push` — push schema to DB

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- Always typecheck from the root: `pnpm run typecheck`
- `emitDeclarationOnly` — JS bundling handled by esbuild/tsx/vite
- Production migrations handled by Replit when publishing; dev uses `push`/`push-force`
