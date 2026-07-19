import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2, Plus, History, Trash2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";

// Variable Pay Engine settings. Values are VERSIONED by effective date — you
// never edit history, you add a new value from a date forward. Days are always
// computed under the config active on that day. The two structured parameters
// (new-rider ramp, Yango goal-bonus table) get proper table editors — admins
// never touch raw JSON.

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface ConfigRow {
  id: number;
  parameter: string;
  value: string;
  effectiveFrom: string;
  createdAt: string;
}

const PARAM_META: Record<string, { label: string; hint: string }> = {
  fleet_enabled: { label: "Fleet features enabled (kill switch)", hint: "true / false — false hides the Fleet tab for every pilot instantly" },
  base_amount: { label: "Base pay (रू/day)", hint: "paid when the shift gates are met" },
  base_min_hours: { label: "Base gate: min hours", hint: "shift hours from verified check-out → check-in" },
  base_min_rides: { label: "Base gate: min rides", hint: "" },
  commission_rate: { label: "Commission rate", hint: "share of revenue (cash + Yango bonus), e.g. 0.20" },
  revenue_cap: { label: "Revenue cap (रू)", hint: "commission counts revenue up to here; growth starts above" },
  growth_rate: { label: "Growth share", hint: "share of revenue above the cap, e.g. 0.40 — no ceiling" },
  ramp: { label: "New-rider ramp", hint: "softer gates for a rider's first active days — click Edit to change" },
  streak_length: { label: "Streak length (days)", hint: "consecutive qualifying active days for the bonus" },
  streak_bonus: { label: "Streak bonus (रू)", hint: "auto-credited on the day the streak completes" },
  monthly_floor: { label: "Monthly wage floor (रू)", hint: "top-up when full schedule is worked (used by payroll)" },
  yango_bonus_table: { label: "Yango goal-bonus table", hint: "mirrors Yango's goal screen; drives the rider app's tier picker and tentative-bonus estimate — click Edit to change" },
};

// The structured params get table editors instead of the raw value form.
const TABLE_PARAMS = ["ramp", "yango_bonus_table"] as const;
type TableParam = (typeof TABLE_PARAMS)[number];

interface BonusRow { trips: string; pct: string; max: string }
interface RampRow { fromDay: string; toDay: string; gateRides: string; gateCash: string; prize: string }

function summarize(param: string, value: string): string {
  try {
    const arr = JSON.parse(value);
    if (!Array.isArray(arr) || arr.length === 0) return value.slice(0, 40);
    if (param === "yango_bonus_table") {
      const trips = arr.map((t) => t.trips);
      const pcts = arr.map((t) => t.pct * 100);
      return `${arr.length} tiers · ${Math.min(...trips)} → ${Math.max(...trips)} trips · +${Math.min(...pcts)}% → +${Math.max(...pcts)}%`;
    }
    if (param === "ramp") {
      const gates = arr.map((t) => t.gateRides);
      return `${arr.length} stages · gates ${gates.join(" / ")} rides`;
    }
  } catch { /* fall through */ }
  return value.length > 40 ? value.slice(0, 40) + "…" : value;
}

export default function PaySettings() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("salary", "canEdit");
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({ parameter: "base_amount", value: "", effectiveFrom: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Table editors
  const [editing, setEditing] = useState<TableParam | null>(null);
  const [bonusRows, setBonusRows] = useState<BonusRow[]>([]);
  const [rampRows, setRampRows] = useState<RampRow[]>([]);
  const [editorDate, setEditorDate] = useState("");
  const [editorErr, setEditorErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`${API_BASE}/salary/pay-config`, { credentials: "include" });
    if (res.ok) setRows((await res.json()).rows);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const today = new Date().toISOString().slice(0, 10);
  const current = useMemo(() => {
    const map = new Map<string, ConfigRow>();
    for (const r of rows) {
      if (r.effectiveFrom > today) continue; // future-dated — visible in history
      const prev = map.get(r.parameter);
      if (!prev || r.effectiveFrom > prev.effectiveFrom) map.set(r.parameter, r);
    }
    return map;
  }, [rows, today]);

  const upcoming = useMemo(() => rows.filter((r) => r.effectiveFrom > today), [rows, today]);

  const openEditor = (param: TableParam) => {
    setEditorErr(null);
    setEditorDate("");
    const value = current.get(param)?.value;
    try {
      const arr = value ? JSON.parse(value) : [];
      if (param === "yango_bonus_table") {
        setBonusRows(
          (Array.isArray(arr) ? arr : []).map((t: { trips: number; pct: number; max: number }) => ({
            trips: String(t.trips), pct: String(Math.round(t.pct * 10000) / 100), max: String(t.max),
          })),
        );
      } else {
        setRampRows(
          (Array.isArray(arr) ? arr : []).map((t: { fromDay: number; toDay: number | null; gateRides: number; gateCash: number; prize: number }) => ({
            fromDay: String(t.fromDay), toDay: t.toDay == null ? "" : String(t.toDay),
            gateRides: String(t.gateRides), gateCash: String(t.gateCash), prize: String(t.prize),
          })),
        );
      }
      setEditing(param);
    } catch {
      setEditorErr("Stored value could not be parsed — fix it via version history.");
    }
  };

  const saveEditor = async () => {
    setEditorErr(null);
    if (!editorDate) { setEditorErr("Pick the effective date — the new table applies from that day forward."); return; }
    let json = "";
    if (editing === "yango_bonus_table") {
      const parsed: { trips: number; pct: number; max: number }[] = [];
      const seen = new Set<number>();
      for (const [i, r] of bonusRows.entries()) {
        const trips = parseInt(r.trips, 10);
        const pct = parseFloat(r.pct);
        const max = parseFloat(r.max);
        if (!Number.isInteger(trips) || trips <= 0) { setEditorErr(`Row ${i + 1}: Trips must be a positive whole number.`); return; }
        if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) { setEditorErr(`Row ${i + 1}: Bonus % must be between 0 and 100.`); return; }
        if (!Number.isFinite(max) || max <= 0) { setEditorErr(`Row ${i + 1}: Max must be a positive amount.`); return; }
        if (seen.has(trips)) { setEditorErr(`Row ${i + 1}: duplicate tier (${trips} trips).`); return; }
        seen.add(trips);
        parsed.push({ trips, pct: Math.round(pct * 100) / 10000, max });
      }
      if (parsed.length === 0) { setEditorErr("At least one tier is required."); return; }
      parsed.sort((a, b) => a.trips - b.trips);
      json = JSON.stringify(parsed);
    } else if (editing === "ramp") {
      const parsed: { fromDay: number; toDay: number | null; gateRides: number; gateCash: number; prize: number }[] = [];
      for (const [i, r] of rampRows.entries()) {
        const fromDay = parseInt(r.fromDay, 10);
        const toDay = r.toDay.trim() === "" ? null : parseInt(r.toDay, 10);
        const gateRides = parseInt(r.gateRides, 10);
        const gateCash = parseFloat(r.gateCash);
        const prize = parseFloat(r.prize);
        if (!Number.isInteger(fromDay) || fromDay <= 0) { setEditorErr(`Stage ${i + 1}: From day must be a positive whole number.`); return; }
        if (toDay != null && (!Number.isInteger(toDay) || toDay < fromDay)) { setEditorErr(`Stage ${i + 1}: To day must be ≥ from day (or empty for open-ended).`); return; }
        if (!Number.isInteger(gateRides) || gateRides <= 0) { setEditorErr(`Stage ${i + 1}: Gate rides must be a positive whole number.`); return; }
        if (!Number.isFinite(gateCash) || gateCash <= 0) { setEditorErr(`Stage ${i + 1}: Gate cash must be positive.`); return; }
        if (!Number.isFinite(prize) || prize < 0) { setEditorErr(`Stage ${i + 1}: Prize must be 0 or more.`); return; }
        parsed.push({ fromDay, toDay, gateRides, gateCash, prize });
      }
      if (parsed.length === 0) { setEditorErr("At least one stage is required."); return; }
      parsed.sort((a, b) => a.fromDay - b.fromDay);
      json = JSON.stringify(parsed);
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/salary/pay-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ parameter: editing, value: json, effectiveFrom: editorDate }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      setMsg({ ok: true, text: `${PARAM_META[editing!]?.label} — new version effective ${editorDate}` });
      setEditing(null);
      refresh();
    } catch (e) {
      setEditorErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/salary/pay-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ parameter: form.parameter, value: form.value.trim(), effectiveFrom: form.effectiveFrom }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      setMsg({ ok: true, text: `${PARAM_META[form.parameter]?.label ?? form.parameter} → ${form.value} from ${form.effectiveFrom}` });
      setForm((f) => ({ ...f, value: "" }));
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const cellCls = "premium-input !py-1.5 !px-2 text-sm font-mono w-full";

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Settings2 className="w-6 h-6" /> Pay Settings</h1>
        <p className="text-sm text-muted-foreground">
          Variable Pay Engine parameters for fleet-pilot riders. Changes are versioned by effective date — past days always
          recompute under the rules that were active on that day.
        </p>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {Object.entries(PARAM_META).map(([key, meta]) => {
          const row = current.get(key);
          const isTable = (TABLE_PARAMS as readonly string[]).includes(key);
          return (
            <div key={key} className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{meta.label}</div>
                  {meta.hint && <div className="text-xs text-muted-foreground">{meta.hint}</div>}
                </div>
                <div className="text-right flex-shrink-0 flex items-center gap-3">
                  <div>
                    <div className={`font-mono text-sm ${key === "fleet_enabled" && row?.value === "false" ? "text-red-600 font-bold" : ""}`}>
                      {row ? (isTable ? summarize(key, row.value) : row.value.length > 42 ? row.value.slice(0, 42) + "…" : row.value) : "(default)"}
                    </div>
                    {row && <div className="text-[11px] text-muted-foreground">since {row.effectiveFrom}</div>}
                  </div>
                  {isTable && canEdit && (
                    <Button variant="outline" size="sm" onClick={() => (editing === key ? setEditing(null) : openEditor(key as TableParam))}>
                      {editing === key ? <X className="w-3.5 h-3.5" /> : <><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</>}
                    </Button>
                  )}
                </div>
              </div>

              {/* ── Yango bonus table editor ── */}
              {editing === "yango_bonus_table" && key === "yango_bonus_table" && (
                <div className="mt-4 rounded-xl border bg-muted/20 p-4 space-y-3">
                  <div className="grid grid-cols-[1fr_1fr_1fr_36px] gap-2 text-xs font-medium text-muted-foreground px-1">
                    <span>Trips</span><span>Bonus %</span><span>Max (रू)</span><span />
                  </div>
                  {bonusRows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_36px] gap-2 items-center">
                      <input className={cellCls} inputMode="numeric" value={r.trips} onChange={(e) => setBonusRows((a) => a.map((x, j) => (j === i ? { ...x, trips: e.target.value } : x)))} />
                      <input className={cellCls} inputMode="decimal" value={r.pct} onChange={(e) => setBonusRows((a) => a.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
                      <input className={cellCls} inputMode="decimal" value={r.max} onChange={(e) => setBonusRows((a) => a.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
                      <button className="text-muted-foreground hover:text-red-600" onClick={() => setBonusRows((a) => a.filter((_, j) => j !== i))} title="Remove tier">
                        <Trash2 className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setBonusRows((a) => [...a, { trips: "", pct: "", max: "" }])}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add tier
                  </Button>
                  <div className="flex items-center gap-3 pt-2 border-t">
                    <label className="text-xs text-muted-foreground">Effective from</label>
                    <input type="date" className="premium-input !py-1.5 w-44" value={editorDate} onChange={(e) => setEditorDate(e.target.value)} />
                    <div className="flex-1" />
                    <Button size="sm" disabled={busy} onClick={saveEditor}>Save as new version</Button>
                  </div>
                  {editorErr && <div className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-600">{editorErr}</div>}
                </div>
              )}

              {/* ── Ramp editor ── */}
              {editing === "ramp" && key === "ramp" && (
                <div className="mt-4 rounded-xl border bg-muted/20 p-4 space-y-3">
                  <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_36px] gap-2 text-xs font-medium text-muted-foreground px-1">
                    <span>From day</span><span>To day (empty = ∞)</span><span>Gate rides</span><span>Gate cash (रू)</span><span>Prize (रू)</span><span />
                  </div>
                  {rampRows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_36px] gap-2 items-center">
                      <input className={cellCls} inputMode="numeric" value={r.fromDay} onChange={(e) => setRampRows((a) => a.map((x, j) => (j === i ? { ...x, fromDay: e.target.value } : x)))} />
                      <input className={cellCls} inputMode="numeric" placeholder="∞" value={r.toDay} onChange={(e) => setRampRows((a) => a.map((x, j) => (j === i ? { ...x, toDay: e.target.value } : x)))} />
                      <input className={cellCls} inputMode="numeric" value={r.gateRides} onChange={(e) => setRampRows((a) => a.map((x, j) => (j === i ? { ...x, gateRides: e.target.value } : x)))} />
                      <input className={cellCls} inputMode="decimal" value={r.gateCash} onChange={(e) => setRampRows((a) => a.map((x, j) => (j === i ? { ...x, gateCash: e.target.value } : x)))} />
                      <input className={cellCls} inputMode="decimal" value={r.prize} onChange={(e) => setRampRows((a) => a.map((x, j) => (j === i ? { ...x, prize: e.target.value } : x)))} />
                      <button className="text-muted-foreground hover:text-red-600" onClick={() => setRampRows((a) => a.filter((_, j) => j !== i))} title="Remove stage">
                        <Trash2 className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setRampRows((a) => [...a, { fromDay: "", toDay: "", gateRides: "", gateCash: "", prize: "" }])}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add stage
                  </Button>
                  <div className="flex items-center gap-3 pt-2 border-t">
                    <label className="text-xs text-muted-foreground">Effective from</label>
                    <input type="date" className="premium-input !py-1.5 w-44" value={editorDate} onChange={(e) => setEditorDate(e.target.value)} />
                    <div className="flex-1" />
                    <Button size="sm" disabled={busy} onClick={saveEditor}>Save as new version</Button>
                  </div>
                  {editorErr && <div className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-600">{editorErr}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}

      {upcoming.length > 0 && (
        <div className="rounded-xl border bg-amber-50/60 border-amber-200 p-4 text-sm">
          <div className="font-medium text-amber-800 mb-1">Scheduled changes</div>
          {upcoming.map((r) => (
            <div key={r.id} className="text-amber-700 text-xs">
              {PARAM_META[r.parameter]?.label ?? r.parameter} → {(TABLE_PARAMS as readonly string[]).includes(r.parameter) ? summarize(r.parameter, r.value) : r.value} from {r.effectiveFrom}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="font-semibold text-sm">Add a new value (simple parameters)</div>
          <div className="grid gap-3 md:grid-cols-3">
            <select className="premium-input bg-white" value={form.parameter} onChange={(e) => setForm((f) => ({ ...f, parameter: e.target.value }))}>
              {Object.entries(PARAM_META)
                .filter(([key]) => !(TABLE_PARAMS as readonly string[]).includes(key))
                .map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
            </select>
            <input className="premium-input font-mono" placeholder="Value" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            <input type="date" className="premium-input" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} />
          </div>
          <Button size="sm" disabled={busy || !form.value.trim() || !form.effectiveFrom} onClick={submit}>
            <Plus className="w-4 h-4 mr-1" /> Add value
          </Button>
        </div>
      )}

      <div>
        <button className="text-sm text-muted-foreground inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => setShowHistory((s) => !s)}>
          <History className="w-4 h-4" /> {showHistory ? "Hide" : "Show"} full version history ({rows.length})
        </button>
        {showHistory && (
          <div className="mt-3 rounded-xl border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="px-4 py-2">Parameter</th>
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">Effective from</th>
                  <th className="px-4 py-2">Added</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{PARAM_META[r.parameter]?.label ?? r.parameter}</td>
                    <td className="px-4 py-2 font-mono text-xs max-w-[280px] truncate">{(TABLE_PARAMS as readonly string[]).includes(r.parameter) ? summarize(r.parameter, r.value) : r.value}</td>
                    <td className="px-4 py-2">{r.effectiveFrom}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
