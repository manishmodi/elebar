// Thin fetch wrapper: JWT auth, auto-refresh-on-401, JSON in/out.

const ACCESS_KEY = "sherpa.access";
const REFRESH_KEY = "sherpa.refresh";

let accessToken: string | null = localStorage.getItem(ACCESS_KEY);
let refreshToken: string | null = localStorage.getItem(REFRESH_KEY);
let refreshPromise: Promise<boolean> | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  errors?: Record<string, string[]> | undefined;

  constructor(status: number, detail: string, errors?: Record<string, string[]> | undefined) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

async function doRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch("/api/auth/refresh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access: string; refresh: string };
    setTokens(data.access, data.refresh);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin() {
  clearTokens();
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: string | undefined;
  body?: unknown;
  params?: QueryParams | undefined;
  skipAuthRedirect?: boolean | undefined;
  isForm?: boolean | undefined;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.pathname + url.search;
}

async function rawFetch(path: string, options: RequestOptions, retry = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (!options.isForm) headers["Content-Type"] = "application/json";
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const body: BodyInit | null = options.isForm
    ? (options.body as BodyInit)
    : options.body !== undefined
      ? JSON.stringify(options.body)
      : null;

  const res = await fetch(buildUrl(path, options.params), {
    method: options.method ?? "GET",
    headers,
    body,
  });

  if (res.status === 401 && retry && !options.skipAuthRedirect) {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      return rawFetch(path, options, false);
    }
    redirectToLogin();
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  return res;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await rawFetch(path, options);

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const detail = (data && (data.detail as string)) || res.statusText || "Request failed";
    const errors = data && (data.errors as Record<string, string[]> | undefined);
    throw new ApiError(res.status, detail, errors);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, params?: QueryParams) => request<T>(path, { method: "GET", params }),
  post: <T>(path: string, body?: unknown, params?: QueryParams) =>
    request<T>(path, { method: "POST", body, params }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form, isForm: true });
  },
};

/** Downloads an authenticated endpoint (e.g. CSV) as a blob and triggers a save. */
export async function downloadBlob(path: string, filename: string, params?: QueryParams) {
  const res = await rawFetch(path, { method: "GET", params });
  if (!res.ok) {
    throw new ApiError(res.status, "Download failed");
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * Opens an authenticated file (e.g. an uploaded KYC image) in a new tab.
 * Plain <a href> won't carry the Authorization header, so we fetch as a
 * blob first and open an object URL instead.
 */
export async function openAuthenticatedFile(path: string) {
  const res = await rawFetch(path, { method: "GET" });
  if (!res.ok) {
    throw new ApiError(res.status, "Could not open file");
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
}

export const PAGE_SIZE = 100;
