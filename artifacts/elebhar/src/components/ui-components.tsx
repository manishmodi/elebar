import { ReactNode, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";

export function PageHeader({ title, description, actions }: { title: string, description?: string, actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <div className={cn("bg-card border border-border shadow-sm rounded-2xl overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status?.toLowerCase() || '';
  let colorClass = "bg-gray-100 text-gray-700 border-gray-200";
  let Icon = Clock;

  if (['active', 'present', 'completed'].includes(normalized)) {
    colorClass = "bg-green-50 text-green-700 border-green-200";
    Icon = CheckCircle2;
  } else if (['maintenance', 'leave', 'half_day', 'holiday'].includes(normalized)) {
    colorClass = "bg-amber-50 text-amber-700 border-amber-200";
    Icon = AlertCircle;
  } else if (['inactive', 'absent', 'ended'].includes(normalized)) {
    colorClass = "bg-red-50 text-red-700 border-red-200";
    Icon = AlertCircle;
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", colorClass)}>
      <Icon className="w-3.5 h-3.5" />
      <span className="capitalize">{status?.replace('_', ' ')}</span>
    </span>
  );
}

export function Button({ 
  children, variant = "primary", className, ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" }) {
  const base = "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";
  
  const variants = {
    primary: "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg focus:ring-primary",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:ring-secondary",
    outline: "border-2 border-input bg-background hover:bg-muted hover:text-foreground focus:ring-ring",
    ghost: "hover:bg-muted hover:text-foreground focus:ring-ring",
    destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus:ring-destructive"
  };

  return (
    <button className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Currency({ amount }: { amount?: string | number | null }) {
  if (amount == null) return <span>-</span>;
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return <span>-</span>;
  return <span className="font-mono tabular-nums">रू {num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

export function EmptyState({ title, description, icon: Icon }: { title: string, description: string, icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
        <Icon className="w-8 h-8" />
      </div>
      <h3 className="text-lg font-display font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
    </div>
  );
}

export function Dialog({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-background rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl font-display font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
             <span className="text-xl leading-none">&times;</span>
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}

interface DropdownMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
}

export function DropdownMenu({ items, trigger }: { items: DropdownMenuItem[], trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-background border rounded-xl shadow-lg py-1 animate-in fade-in slide-in-from-top-2 duration-150">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-muted",
                item.variant === "destructive" && "text-destructive hover:bg-destructive/10"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, description, confirmLabel = "Delete", isPending = false }: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  isPending?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200">
        <h3 className="text-lg font-display font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-6">{description}</p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Processing..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
