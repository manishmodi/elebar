---
name: API codegen build chain (orval → dist d.ts → app tsc)
description: Why a new openapi.yaml field can be invisible to an app's tsc even after running codegen, and how to make it propagate.
---

# API codegen build chain

The API contract is hand-maintained in `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec run codegen` (orval) regenerates SOURCE in both `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

**The trap:** running codegen alone is NOT enough for a consuming app's `tsc --noEmit` to see new fields. `lib/api-client-react` is a `composite` project (`emitDeclarationOnly`, `outDir: dist`). Apps like `artifacts/elebhar` consume it via a TS **project reference**, so their tsc reads the emitted `dist/*.d.ts`, NOT the freshly-generated source. After codegen you must rebuild the lib's declarations:

```
npx tsc --build lib/api-client-react/tsconfig.json lib/api-zod/tsconfig.json --force
```

**Second trap:** `tsconfig.base.json` sets `noEmitOnError: true`. ANY type error in the lib (even pre-existing, in an unrelated file) blocks ALL declaration emit, so `dist/*.d.ts` stays stale forever and new fields never reach the app. Symptom: app tsc says `'<field>' does not exist in type '<X>Params'` even though the generated source clearly has it.

**Why:** project references redirect module resolution to the declaration output, and `noEmitOnError` silently suppresses that output on any error.

**How to apply:** when a codegen-added field isn't visible to an app, (1) rebuild the lib declarations with `tsc --build ... --force`, (2) if that fails, fix whatever type error is blocking emit (it can be unrelated to your change), (3) confirm the field landed in `lib/api-client-react/dist/generated/api.schemas.d.ts`. A known historical blocker was `import.meta.env` in `custom-fetch.ts` (lib has no vite/client types) — fixed with a local cast, not a global ImportMeta augmentation (that would leak into consumers and clash with their vite/client).

Also: response fields the backend returns via its select join (e.g. attendance `vehicleId`, usage fields) must be added to the **response** schema in openapi.yaml to be typed on the client — they are NOT inferred from the route handler.
