import { formatCurrency } from "@/lib/format";

export function Currency({ value, className }: { value: string | number | null | undefined; className?: string }) {
  return <span className={className}>{formatCurrency(value)}</span>;
}
