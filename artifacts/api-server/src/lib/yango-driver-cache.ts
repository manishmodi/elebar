import { isConfigured } from "./yango-client.js";

export interface CachedDriver {
  driver_profile_id: string;
  name: string;
  phones: string[];
}

interface CacheState {
  drivers: CachedDriver[];
  loadedAt: Date | null;
  loading: boolean;
  error: string | null;
  total: number;
  progress: number; // drivers fetched so far during load
}

const state: CacheState = {
  drivers: [],
  loadedAt: null,
  loading: false,
  error: null,
  total: 0,
  progress: 0,
};

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PAGE_SIZE = 500;
const PAGE_DELAY_MS = 2_000;   // 2 seconds between pages
const RATE_LIMIT_WAIT_MS = 90_000; // 90 seconds on 429

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function resolveYangoCredentials() {
  let clientId = process.env.YANGO_CLIENT_ID ?? "";
  let parkId = process.env.YANGO_PARK_ID ?? "";
  const apiKey = process.env.YANGO_API_KEY ?? "";

  if (!clientId.startsWith("taxi/") && parkId.startsWith("taxi/")) {
    [clientId, parkId] = [parkId, clientId];
  }
  if (clientId && !clientId.startsWith("taxi/")) {
    clientId = `taxi/park/${clientId}`;
  }
  if (parkId.startsWith("taxi/park/")) {
    parkId = parkId.replace("taxi/park/", "");
  }
  return { clientId, parkId, apiKey };
}

async function fetchPage(offset: number, retries = 3): Promise<{ drivers: CachedDriver[]; total: number } | null> {
  const { clientId, parkId, apiKey } = resolveYangoCredentials();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch("https://fleet-api.yango.tech/v1/parks/driver-profiles/list", {
      method: "POST",
      headers: {
        "X-Client-ID": clientId,
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Accept-Language": "en",
      },
      body: JSON.stringify({
        query: { park: { id: parkId } },
        fields: {
          driver_profile: ["id", "first_name", "last_name", "middle_name", "phones", "work_status"],
        },
        limit: PAGE_SIZE,
        offset,
      }),
    });

    if (res.status === 429) {
      console.log(`[Yango Cache] Rate limited (429). Waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry...`);
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Yango API → ${res.status}: ${text}`);
    }

    const data: any = await res.json();
    const total: number = data.total ?? 0;
    const items: CachedDriver[] = (data.driver_profiles ?? [])
      .filter((d: any) => d.driver_profile?.work_status === "working")
      .map((d: any) => ({
        driver_profile_id: d.driver_profile?.id ?? "",
        name: [d.driver_profile?.first_name, d.driver_profile?.middle_name, d.driver_profile?.last_name]
          .filter(Boolean).join(" "),
        phones: d.driver_profile?.phones ?? [],
      }));

    return { drivers: items, total };
  }

  throw new Error("Max retries exceeded after rate limiting");
}

async function loadAllDrivers() {
  if (state.loading) return;
  if (!isConfigured()) return;

  state.loading = true;
  state.error = null;
  state.progress = 0;
  console.log("[Yango Cache] Starting background load of all active drivers...");

  const allDrivers: CachedDriver[] = [];
  let offset = 0;
  let apiTotal = Infinity;

  try {
    while (offset < apiTotal) {
      const result = await fetchPage(offset);
      if (!result) break;

      allDrivers.push(...result.drivers);
      apiTotal = result.total;
      offset += PAGE_SIZE;
      state.progress = allDrivers.length;
      // Make partial results searchable immediately
      state.drivers = allDrivers.slice();

      console.log(`[Yango Cache] Fetched offset ${offset}/${apiTotal} — ${allDrivers.length} active drivers so far`);

      if (offset < apiTotal) {
        await sleep(PAGE_DELAY_MS);
      }
    }

    state.drivers = allDrivers;
    state.total = allDrivers.length;
    state.loadedAt = new Date();
    state.error = null;
    console.log(`[Yango Cache] Done. ${state.total} active drivers cached.`);
  } catch (err: any) {
    state.error = err?.message ?? "Unknown error";
    console.error("[Yango Cache] Load failed:", state.error);
    // Keep any partial results that were loaded
    if (allDrivers.length > 0) {
      state.drivers = allDrivers;
      state.total = allDrivers.length;
      state.loadedAt = new Date();
    }
  } finally {
    state.loading = false;
    state.progress = 0;
  }
}

export function getCacheState() {
  return {
    ready: state.loadedAt !== null,
    loading: state.loading,
    error: state.error,
    total: state.total,
    progress: state.progress,
    loadedAt: state.loadedAt,
  };
}

export function searchDrivers(q: string): CachedDriver[] {
  // Lazily start loading the cache the first time someone searches
  if (!state.loading && !state.loadedAt && !state.error) {
    loadAllDrivers();
  }
  if (!q) return [];
  const lower = q.toLowerCase();
  return state.drivers.filter(d =>
    d.name.toLowerCase().includes(lower) ||
    d.phones.some(p => p.includes(lower)) ||
    d.driver_profile_id.includes(lower)
  ).slice(0, 50);
}

export function getAllDrivers(): CachedDriver[] {
  return state.drivers;
}

export function startDriverCache() {
  // No longer loads on startup — cache is loaded lazily when the first
  // driver search is made (see searchDrivers). This avoids burning the
  // Yango rate limit budget needed by sync on server start.
  // Refresh once per day (only kicks in after the cache has been loaded).
  setInterval(() => {
    if (state.loadedAt) loadAllDrivers();
  }, REFRESH_INTERVAL_MS);
}

export async function forceRefresh() {
  state.loading = false;
  await loadAllDrivers();
}
