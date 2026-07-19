import { previewForDate, type PreviewResult } from "./yango-sync.js";
import { resetThrottle } from "./yango-client.js";

/**
 * Background preview jobs.
 *
 * The Yango park is the whole marketplace and rate-limits hard, so a full preview for the
 * fleet can take several minutes — far longer than the deployment's ~60s HTTP proxy
 * timeout. Running it inside the request 504s. Instead we kick the work off in the
 * background, return a job id immediately, and let the UI poll for progress + result.
 *
 * Single-flight: only one preview job runs at a time. A repeated request for the SAME
 * date attaches to the in-flight job (so duplicate clicks don't multiply load on the
 * shared park); a request for a DIFFERENT date while one is running is rejected as a
 * conflict so two dates can never be confused. Finished jobs are retained by id for a
 * short TTL so a poller always resolves its own job's terminal status/result even if a
 * new job has since started.
 */
export interface PreviewJob {
  id: string;
  date: string;
  status: "running" | "done" | "error";
  total: number;
  completed: number;
  result?: PreviewResult;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const RETENTION_MS = 10 * 60 * 1000;
const jobs = new Map<string, PreviewJob>();
let runningId: string | null = null;

/** Drop finished jobs older than the retention window so the map can't grow unbounded. */
function pruneOld(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== "running" && job.finishedAt && now - job.finishedAt > RETENTION_MS) {
      jobs.delete(id);
    }
  }
}

function runningJob(): PreviewJob | null {
  if (!runningId) return null;
  const job = jobs.get(runningId);
  return job && job.status === "running" ? job : null;
}

/**
 * Start a preview job. Returns `{ job, conflict }`:
 * - conflict=false: a new job was started, or the caller attached to an in-flight job for
 *   the SAME date.
 * - conflict=true: a job for a DIFFERENT date is already running; `job` is that running
 *   job (the route turns this into a 409 so the caller waits instead of mixing dates).
 */
export function startPreviewJob(date: string, riderIds?: number[] | null): { job: PreviewJob; conflict: boolean } {
  pruneOld();

  const running = runningJob();
  if (running) {
    return { job: running, conflict: running.date !== date };
  }

  const job: PreviewJob = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    status: "running",
    total: 0,
    completed: 0,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  runningId = job.id;

  // Start each run with optimistic pacing rather than inheriting a maxed-out interval.
  resetThrottle();

  // Fire-and-forget: the work outlives the HTTP request that started it.
  previewForDate(date, (completed, total) => {
    job.completed = completed;
    job.total = total;
  }, riderIds)
    .then((result) => {
      job.result = result;
      job.status = "done";
    })
    .catch((err: any) => {
      job.error = err?.message ?? String(err);
      job.status = "error";
    })
    .finally(() => {
      job.finishedAt = Date.now();
      if (runningId === job.id) runningId = null;
    });

  return { job, conflict: false };
}

/** Look up a job by id (jobs are retained briefly after finishing so pollers resolve). */
export function getPreviewJob(id: string): PreviewJob | null {
  pruneOld();
  return jobs.get(id) ?? null;
}
