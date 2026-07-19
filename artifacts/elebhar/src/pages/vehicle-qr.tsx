import { useMemo, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVehicles } from "@/hooks/use-vehicles";

// Printable QR sticker sheet for the rider-app scooter handover. Each sticker
// encodes the vehicle NUMBER (stable, unique-indexed); the fleet API's
// checkout resolver also accepts the plate, so either works if re-stickered.

export default function VehicleQr() {
  const { data: vehicles } = useVehicles();
  const gridRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => (Array.isArray(vehicles) ? vehicles.filter((v) => v.status === "active") : []),
    [vehicles],
  );

  const print = () => {
    if (!gridRef.current) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Vehicle QR Stickers</title>
      <style>
        body { font-family: sans-serif; margin: 16px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .sticker { border: 1.5px dashed #999; border-radius: 10px; padding: 14px; text-align: center; page-break-inside: avoid; }
        .plate { font-weight: 700; font-size: 15px; margin-top: 8px; letter-spacing: 0.5px; }
        .num { color: #555; font-size: 12px; margin-top: 2px; }
        .brand { color: #888; font-size: 10px; margin-top: 6px; }
      </style></head><body>
      <div class="grid">${gridRef.current.innerHTML}</div>
      <script>window.onload = () => { window.print(); }</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><QrCode className="w-6 h-6" /> Vehicle QR Stickers</h1>
          <p className="text-sm text-muted-foreground">
            Print and stick one on each scooter — riders scan it at check-out and exchange. The code encodes the vehicle
            number; a new sticker after re-plating keeps working.
          </p>
        </div>
        <Button onClick={print} disabled={active.length === 0}>
          <Printer className="w-4 h-4 mr-1" /> Print all ({active.length})
        </Button>
      </div>

      <div ref={gridRef} className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {active.map((v) => (
          <div key={v.id} className="sticker border-2 border-dashed rounded-xl p-4 text-center bg-white">
            <QRCodeSVG value={v.vehicleNumber ?? String(v.id)} size={140} marginSize={2} className="mx-auto" />
            <div className="plate font-bold text-sm mt-2 tracking-wide">{v.plateNumber}</div>
            <div className="num text-xs text-muted-foreground">{v.vehicleNumber}</div>
            <div className="brand text-[10px] text-muted-foreground mt-1">Elebhar Fleet — scan at check-out</div>
          </div>
        ))}
      </div>
    </div>
  );
}
