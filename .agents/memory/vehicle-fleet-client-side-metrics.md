---
name: Vehicle fleet client-side metrics
description: How per-vehicle metrics (Revenue, Days Active) are computed on the frontend in the Vehicle Fleet list
---

Per-vehicle metrics on the Vehicle Fleet list page are computed **client-side**, not via backend aggregation. The page fetches full datasets (daily logs, attendance) via their normal list hooks and builds `useMemo` maps keyed by `vehicleId`, filtered by the page's From/To date range (`fromAD`/`toAD`).

- **Revenue** = sum of `totalIncome` from daily logs per vehicle.
- **Days Active** = count of DISTINCT attendance dates per vehicle (built with a `Set<string>` of `date.split("T")[0]`, so two riders on the same vehicle+date count once). Any attendance status counts; absent records have no vehicle so they contribute nothing.

**Why:** matches the existing revenue pattern and avoids openapi/codegen changes; the app already fetches these lists wholesale at current scale.

**How to apply:** to add another fleet metric, mirror the `revenueMap`/`daysActiveMap` `useMemo` in `artifacts/elebhar/src/pages/vehicles.tsx`, keep the same `fromAD`/`toAD` boundary filtering (`< fromAD` and `> toAD` excluded = inclusive range), and bump the table `colSpan` for loading/empty rows when adding a column. If attendance/log volume grows large, revisit with server-side aggregation.
