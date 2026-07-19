import { useState } from "react";
import { Database, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * TEMP MIGRATION COMPONENT — remove after cutover.
 * Admin-only button that pulls all data from the production DB into the DB this
 * app is connected to. Production is read-only; only the local DB is written.
 */

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface SyncResultRow {
  table: string;
  status: string;
  copied: number;
}

export function TempProdSync() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ totalCopied: number; results: SyncResultRow[] } | null>(null);

  const runSync = async () => {
    if (
      !window.confirm(
        "Replace ALL data in THIS database with a fresh copy from production?\n\n" +
          "• Production is only read — it is never modified.\n" +
          "• This local database will be wiped and reloaded.\n\n" +
          "Continue?",
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/admin/sync-from-production`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Temporary: Migrate data from production
          </h3>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Pulls a fresh copy of every record from the production database into this one.
            Production is read-only and never changed; this database is wiped and reloaded.
            After it finishes, log out and back in.
          </p>

          <button
            onClick={runSync}
            disabled={running}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {running ? "Syncing… (this can take a minute)" : "Sync from Production"}
          </button>

          {error && (
            <p className="mt-3 rounded-md bg-red-100 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          {result && (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Done — {result.totalCopied} rows copied. Log out and back in to refresh your session.
              </p>
              <div className="mt-2 max-h-48 overflow-auto rounded-md border border-amber-200 bg-white dark:border-amber-800 dark:bg-zinc-900">
                <table className="w-full text-xs">
                  <tbody>
                    {result.results.map((r) => (
                      <tr key={r.table} className="border-b border-amber-100 last:border-0 dark:border-zinc-800">
                        <td className="px-3 py-1.5 font-mono text-foreground">{r.table}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.status}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{r.copied}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
