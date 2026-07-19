import { useEffect, useState, type FormEvent } from "react";
import { useRiderOptions, useVehicleOptions } from "@/hooks/use-options";
import { FormSection, TextField, SelectField } from "@/components/FormField";
import type { DailyLog } from "@/lib/types";
import { todayISO } from "@/lib/format";

export type DailyLogFormValues = Omit<DailyLog, "id" | "rider_name" | "vehicle_number" | "yango_synced_at">;

const EMPTY: DailyLogFormValues = {
  rider: "",
  vehicle: "",
  nepali_date: null,
  english_date: todayISO(),
  check_in_time: null,
  check_out_time: null,
  daily_bonus_set: null,
  total_rides_received: null,
  rides_completed: null,
  acceptance_rate: null,
  bonus_target_completion: null,
  total_ride_distance_km: null,
  total_ride_hours: null,
  total_app_online: null,
  cash_as_per_app: null,
  goal_bonus: null,
  promotion_bonus_other: null,
  total_income: null,
  cash_given_by_driver: null,
  cash_transferred_online: null,
  cash_check: null,
  daily_allowance: null,
  additional_expenses: null,
  remarks: null,
  is_draft: false,
};

function str(v: string | null | undefined) {
  return v ?? "";
}
function num(v: number | null | undefined) {
  return v ?? "";
}

interface DailyLogFormProps {
  initial?: DailyLog | null;
  onSubmit: (values: DailyLogFormValues) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

export function DailyLogForm({ initial, onSubmit, onCancel, submitting }: DailyLogFormProps) {
  const riderOptions = useRiderOptions();
  const vehicleOptions = useVehicleOptions();
  const [values, setValues] = useState<DailyLogFormValues>(EMPTY);

  useEffect(() => {
    if (initial) {
      const { id: _id, rider_name: _rn, vehicle_number: _vn, yango_synced_at: _ys, ...rest } = initial;
      setValues(rest);
    } else {
      setValues(EMPTY);
    }
  }, [initial]);

  const set = <K extends keyof DailyLogFormValues>(key: K, value: DailyLogFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit}>
      <FormSection title="Trip details">
        <SelectField label="Rider" required value={values.rider} onChange={(e) => set("rider", e.target.value)}>
          <option value="">Select rider…</option>
          {riderOptions.data?.results.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </SelectField>
        <SelectField label="Vehicle" required value={values.vehicle} onChange={(e) => set("vehicle", e.target.value)}>
          <option value="">Select vehicle…</option>
          {vehicleOptions.data?.results.map((v) => (
            <option key={v.id} value={v.id}>{v.vehicle_number}</option>
          ))}
        </SelectField>
        <TextField label="English date" type="date" required value={values.english_date} onChange={(e) => set("english_date", e.target.value)} />
        <TextField label="Nepali date" value={str(values.nepali_date)} onChange={(e) => set("nepali_date", e.target.value || null)} />
        <TextField label="Check-in time" type="time" value={str(values.check_in_time)} onChange={(e) => set("check_in_time", e.target.value || null)} />
        <TextField label="Check-out time" type="time" value={str(values.check_out_time)} onChange={(e) => set("check_out_time", e.target.value || null)} />
      </FormSection>

      <FormSection title="Ride performance">
        <TextField label="Total rides received" type="number" value={num(values.total_rides_received)} onChange={(e) => set("total_rides_received", e.target.value ? Number(e.target.value) : null)} />
        <TextField label="Rides completed" type="number" value={num(values.rides_completed)} onChange={(e) => set("rides_completed", e.target.value ? Number(e.target.value) : null)} />
        <TextField label="Acceptance rate (%)" type="number" step="0.01" value={str(values.acceptance_rate)} onChange={(e) => set("acceptance_rate", e.target.value || null)} />
        <TextField label="Total ride distance (km)" type="number" step="0.01" value={str(values.total_ride_distance_km)} onChange={(e) => set("total_ride_distance_km", e.target.value || null)} />
        <TextField label="Total ride hours" type="number" step="0.01" value={str(values.total_ride_hours)} onChange={(e) => set("total_ride_hours", e.target.value || null)} />
        <TextField label="Total app online (hrs)" type="number" step="0.01" value={str(values.total_app_online)} onChange={(e) => set("total_app_online", e.target.value || null)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={values.bonus_target_completion ?? false} onChange={(e) => set("bonus_target_completion", e.target.checked)} />
          Bonus target completed
        </label>
        <TextField label="Daily bonus set" type="number" step="0.01" value={str(values.daily_bonus_set)} onChange={(e) => set("daily_bonus_set", e.target.value || null)} />
      </FormSection>

      <FormSection title="Money">
        <TextField label="Cash as per app" type="number" step="0.01" value={str(values.cash_as_per_app)} onChange={(e) => set("cash_as_per_app", e.target.value || null)} />
        <TextField label="Goal bonus" type="number" step="0.01" value={str(values.goal_bonus)} onChange={(e) => set("goal_bonus", e.target.value || null)} />
        <TextField label="Promotion / other bonus" type="number" step="0.01" value={str(values.promotion_bonus_other)} onChange={(e) => set("promotion_bonus_other", e.target.value || null)} />
        <TextField label="Total income" type="number" step="0.01" value={str(values.total_income)} onChange={(e) => set("total_income", e.target.value || null)} />
        <TextField label="Cash given by driver" type="number" step="0.01" value={str(values.cash_given_by_driver)} onChange={(e) => set("cash_given_by_driver", e.target.value || null)} />
        <TextField label="Cash transferred online" type="number" step="0.01" value={str(values.cash_transferred_online)} onChange={(e) => set("cash_transferred_online", e.target.value || null)} />
        <TextField label="Cash check" type="number" step="0.01" value={str(values.cash_check)} onChange={(e) => set("cash_check", e.target.value || null)} />
        <TextField label="Daily allowance" type="number" step="0.01" value={str(values.daily_allowance)} onChange={(e) => set("daily_allowance", e.target.value || null)} />
        <TextField label="Additional expenses" type="number" step="0.01" value={str(values.additional_expenses)} onChange={(e) => set("additional_expenses", e.target.value || null)} />
      </FormSection>

      <FormSection title="Notes">
        <TextField label="Remarks" value={str(values.remarks)} onChange={(e) => set("remarks", e.target.value || null)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={values.is_draft} onChange={(e) => set("is_draft", e.target.checked)} />
          Save as draft
        </label>
      </FormSection>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Create log"}
        </button>
      </div>
    </form>
  );
}
