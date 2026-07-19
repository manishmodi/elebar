---
name: OpenAPI request schemas must list every writable field
description: Why running orval codegen can silently cause data loss on save, and where the source of truth must be kept complete.
---

# OpenAPI request schemas must list every writable field

Routes validate with the generated zod request bodies (`Create<X>Body` / `Update<X>Body`) via `XxxBody.safeParse(req.body)` and then write `parsed.data`. zod `.object()` **strips unknown keys**, so any field the form sends that is NOT in the request schema is silently dropped before insert/update → stored as NULL, no error.

**The trap:** the generated zod is regenerated from `lib/api-spec/openapi.yaml`. If someone hand-patches the *generated* file to add fields that are missing from the openapi **request** schema, the next `codegen` run overwrites the patch and the fields vanish — silently breaking save. This happened to attendance (10 vehicle/battery/scooter/time/distance fields) and vehicles (`lastServiceDate`, `lastServiceOdometer`).

**Why:** the openapi `Create<X>` request schema is the single source of truth for what the write validator accepts. A response schema having a field does NOT make it writable — request and response are separate schemas.

**How to apply:**
- When a new DB column should be user-settable, add it to the openapi `Create<X>` request schema (PUT routes usually `$ref` the same Create schema, so this fixes create AND edit). Then `codegen` + `tsc --build --force` the libs.
- Never patch `lib/*/src/generated/*` by hand — it is overwritten by codegen.
- Match types to the Drizzle column: integer column → openapi `integer` → `zod.number()`; text → `string`.
- Leave server-generated/readOnly fields (e.g. auto-generated `vehicleNumber`) OUT of the writable body; mark them `readOnly: true` so orval excludes them.
- This app does NOT runtime-validate responses (orval uses TS types for responses, zod only for requests), so response-schema type drift is compile-time only, not a display break.
