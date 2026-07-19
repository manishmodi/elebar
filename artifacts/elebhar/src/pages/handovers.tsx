import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Bike, Battery, Gauge, HandCoins, RefreshCw, Camera, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// Guard console: live queue of rider-app handovers awaiting physical
// verification. Gated by the SAME permission as manual attendance entry —
// verifying is attendance editing, just faster.

const API_BASE = `${import.meta.env.BASE_URL}api`;
const POLL_MS = 5000;

interface PendingHandover {
  id: number;
  riderId: number;
  riderName: string | null;
  englishDate: string;
  kind: "checkout" | "exchange" | "checkin";
  payload: Record<string, unknown>;
  vehicleId: number | null;
  vehiclePlate: string | null;
  submittedAt: string;
}

const KIND_META: Record<string, { label: string; badge: string }> = {
  checkout: { label: "Check-out (start shift)", badge: "bg-blue-100 text-blue-700" },
  exchange: { label: "Scooter exchange", badge: "bg-amber-100 text-amber-700" },
  checkin: { label: "Check-in + cash", badge: "bg-emerald-100 text-emerald-700" },
};

function PhotoLinks({ payload }: { payload: Record<string, unknown> }) {
  const collect = (obj: unknown): [string, string][] => {
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj as Record<string, string>).filter(([, v]) => typeof v === "string" && v.startsWith("/objects/"));
  };
  const paths: [string, string][] = [
    ...collect(payload["photoPaths"]),
    ...collect((payload["closing"] as Record<string, unknown>)?.["photoPaths"]),
    ...collect((payload["opening"] as Record<string, unknown>)?.["photoPaths"]),
  ];
  if (paths.length === 0) return null;
  return (
    <div className="flex gap-2 flex-wrap">
      {paths.map(([name, p]) => (
        <a key={p} href={`${API_BASE}/storage${p}`} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1 text-xs text-primary underline">
          <Camera className="w-3 h-3" /> {name}
        </a>
      ))}
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Bike; label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm bg-muted/50 rounded-lg px-2.5 py-1">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function HandoverCard({ h, onDone }: { h: PendingHandover; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = h.payload;
  const meta = KIND_META[h.kind] ?? KIND_META.checkout;

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/fleet/handovers/${h.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submittedTime = new Date(h.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="p-4 rounded-xl border bg-card shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{h.riderName ?? `Rider #${h.riderId}`}</div>
          <div className="text-xs text-muted-foreground">{h.englishDate} · submitted {submittedTime}</div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${meta.badge}`}>{meta.label}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Detail icon={Bike} label="Scooter" value={h.vehiclePlate ?? (h.vehicleId ? `#${h.vehicleId}` : null)} />
        {h.kind === "checkout" && (
          <>
            <Detail icon={Gauge} label="Odometer" value={p["odometerOut"] as number} />
            <Detail icon={Battery} label="Battery" value={p["batteryOutPct"] != null ? `${p["batteryOutPct"]}%` : null} />
            <Detail icon={ShieldCheck} label="Goal" value={p["goalTier"] != null ? `${p["goalTier"]} rides` : null} />
          </>
        )}
        {h.kind === "exchange" && (
          <>
            <Detail icon={Gauge} label="Returned @ odo" value={(p["closing"] as Record<string, unknown>)?.["odometer"] as number} />
            <Detail icon={Battery} label="Returned battery" value={`${(p["closing"] as Record<string, unknown>)?.["batteryPct"]}%`} />
            <Detail icon={ShieldCheck} label="Reason" value={String(p["reason"] ?? "")} />
            <Detail icon={Gauge} label="New @ odo" value={(p["opening"] as Record<string, unknown>)?.["odometer"] as number} />
          </>
        )}
        {h.kind === "checkin" && (
          <>
            <Detail icon={Gauge} label="Odometer" value={p["odometerIn"] as number} />
            <Detail icon={Battery} label="Battery" value={p["batteryInPct"] != null ? `${p["batteryInPct"]}%` : null} />
            <Detail icon={HandCoins} label="Cash declared" value={`रू ${p["cashDeclared"] ?? 0}`} />
            <Detail icon={HandCoins} label="Wallet" value={`रू ${p["walletDeclared"] ?? 0}`} />
          </>
        )}
      </div>

      <PhotoLinks payload={p} />

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {rejecting ? (
        <div className="flex gap-2 items-center">
          <input
            className="premium-input flex-1"
            placeholder="Reason the rider will see (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => act("reject", { reason })}>
            Reject
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejecting(false); setReason(""); }}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => act("verify", {})}>
            <Check className="w-4 h-4 mr-1" />
            {h.kind === "checkout" ? "Confirm & release key" : h.kind === "checkin" ? "Cash counted — confirm" : "Confirm exchange"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Handovers() {
  const [pending, setPending] = useState<PendingHandover[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/fleet/handovers/pending`, { credentials: "include" });
      if (res.ok) setPending(await res.json());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Handovers</h1>
          <p className="text-sm text-muted-foreground">
            Rider-app submissions awaiting your verification — confirming writes attendance (and cash collection for check-ins) exactly like manual entry.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {!loaded ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="text-center py-14 text-muted-foreground text-sm bg-muted/30 rounded-xl border">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No pending handovers. New rider-app submissions appear here automatically.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {pending.map((h) => (
            <HandoverCard key={h.id} h={h} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
