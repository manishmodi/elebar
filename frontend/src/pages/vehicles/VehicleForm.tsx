import { useEffect, useState, type FormEvent } from "react";
import { FormSection, TextField, SelectField } from "@/components/FormField";
import type { Vehicle } from "@/lib/types";

export type VehicleFormValues = Omit<Vehicle, "id" | "vehicle_number" | "in_servicing_since">;

const EMPTY: VehicleFormValues = {
  plate_number: "",
  vehicle_type: "",
  brand: "",
  model: "",
  manufacture_year: null,
  color: null,
  purchase_date: null,
  purchase_cost: null,
  battery_details: null,
  insurance_issue_date: null,
  insurance_expiry: null,
  tax_expiry: null,
  service_due_date: null,
  last_service_date: null,
  last_service_odometer: null,
  servicing_payment: null,
  odometer_reading: "",
  status: "active",
  location_branch: null,
  gps_installed: "",
  gps_number: null,
  gps_id_password: null,
  scooter_branding: null,
  yango_branding_date: null,
  branding_payment: null,
  brandwrap_expire_date: null,
  bluebook_issue_date: null,
  bluebook_expiry_date: null,
};

const TEXT_FIELDS = new Set<keyof VehicleFormValues>([
  "vehicle_type", "brand", "model", "color", "battery_details", "servicing_payment",
  "odometer_reading", "location_branch", "gps_installed", "gps_number",
  "gps_id_password", "scooter_branding", "branding_payment",
]);

function str(v: string | null | undefined): string {
  return v ?? "";
}

interface VehicleFormProps {
  initial?: Vehicle | null;
  onSubmit: (values: VehicleFormValues) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

export function VehicleForm({ initial, onSubmit, onCancel, submitting }: VehicleFormProps) {
  const [values, setValues] = useState<VehicleFormValues>(EMPTY);

  useEffect(() => {
    if (initial) {
      const { id: _id, vehicle_number: _vn, in_servicing_since: _isv, ...rest } = initial;
      setValues(rest);
    } else {
      setValues(EMPTY);
    }
  }, [initial]);

  const set = <K extends keyof VehicleFormValues>(key: K, value: VehicleFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...values };
    for (const key of Object.keys(body) as (keyof VehicleFormValues)[]) {
      // Text fields must be "" not null; date/number fields legitimately null.
      if (body[key] === null && TEXT_FIELDS.has(key)) (body as Record<string, unknown>)[key] = "";
    }
    await onSubmit(body);
  };

  return (
    <form onSubmit={handleSubmit}>
      {initial && (
        <p className="form-hint" style={{ marginBottom: 10 }}>
          Vehicle number: <strong>{initial.vehicle_number}</strong>
        </p>
      )}
      <FormSection title="Basic details">
        <TextField label="Plate number" required value={values.plate_number} onChange={(e) => set("plate_number", e.target.value)} />
        <TextField label="Vehicle type" required value={values.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)} />
        <TextField label="Brand" value={values.brand} onChange={(e) => set("brand", e.target.value)} />
        <TextField label="Model" value={values.model} onChange={(e) => set("model", e.target.value)} />
        <TextField label="Manufacture year" type="number" value={values.manufacture_year ?? ""} onChange={(e) => set("manufacture_year", e.target.value ? Number(e.target.value) : null)} />
        <TextField label="Color" value={str(values.color)} onChange={(e) => set("color", e.target.value || null)} />
        <TextField label="Odometer reading (km)" type="number" value={values.odometer_reading ?? ""} onChange={(e) => set("odometer_reading", e.target.value)} />
        <SelectField label="Status" value={values.status} onChange={(e) => set("status", e.target.value as VehicleFormValues["status"])}>
          <option value="active">Active</option>
          <option value="maintenance">Maintenance</option>
          <option value="inactive">Inactive</option>
        </SelectField>
        <TextField label="Location / branch" value={str(values.location_branch)} onChange={(e) => set("location_branch", e.target.value || null)} />
        <TextField label="Battery details" value={str(values.battery_details)} onChange={(e) => set("battery_details", e.target.value || null)} />
      </FormSection>

      <FormSection title="Purchase & documents">
        <TextField label="Purchase date" type="date" value={str(values.purchase_date)} onChange={(e) => set("purchase_date", e.target.value || null)} />
        <TextField label="Purchase cost" type="number" step="0.01" value={str(values.purchase_cost)} onChange={(e) => set("purchase_cost", e.target.value || null)} />
        <TextField label="Bluebook issue date" type="date" value={str(values.bluebook_issue_date)} onChange={(e) => set("bluebook_issue_date", e.target.value || null)} />
        <TextField label="Bluebook expiry date" type="date" value={str(values.bluebook_expiry_date)} onChange={(e) => set("bluebook_expiry_date", e.target.value || null)} />
        <TextField label="Insurance issue date" type="date" value={str(values.insurance_issue_date)} onChange={(e) => set("insurance_issue_date", e.target.value || null)} />
        <TextField label="Insurance expiry" type="date" value={str(values.insurance_expiry)} onChange={(e) => set("insurance_expiry", e.target.value || null)} />
        <TextField label="Tax expiry" type="date" value={str(values.tax_expiry)} onChange={(e) => set("tax_expiry", e.target.value || null)} />
      </FormSection>

      <FormSection title="Servicing">
        <TextField label="Service due date" type="date" value={str(values.service_due_date)} onChange={(e) => set("service_due_date", e.target.value || null)} />
        <TextField label="Last service date" type="date" value={str(values.last_service_date)} onChange={(e) => set("last_service_date", e.target.value || null)} />
        <TextField label="Last service odometer" type="number" value={values.last_service_odometer ?? ""} onChange={(e) => set("last_service_odometer", e.target.value ? Number(e.target.value) : null)} />
        <TextField label="Servicing payment" type="number" step="0.01" value={str(values.servicing_payment)} onChange={(e) => set("servicing_payment", e.target.value || null)} />
      </FormSection>

      <FormSection title="GPS">
        <label className="checkbox-row">
          <input type="checkbox" checked={values.gps_installed === "yes"} onChange={(e) => set("gps_installed", e.target.checked ? "yes" : "no")} />
          GPS installed
        </label>
        <TextField label="GPS number" value={str(values.gps_number)} onChange={(e) => set("gps_number", e.target.value || null)} />
        <TextField label="GPS ID / password" value={str(values.gps_id_password)} onChange={(e) => set("gps_id_password", e.target.value || null)} />
      </FormSection>

      <FormSection title="Branding">
        <TextField label="Scooter branding" value={str(values.scooter_branding)} onChange={(e) => set("scooter_branding", e.target.value || null)} />
        <TextField label="Yango branding date" type="date" value={str(values.yango_branding_date)} onChange={(e) => set("yango_branding_date", e.target.value || null)} />
        <TextField label="Branding payment" type="number" step="0.01" value={str(values.branding_payment)} onChange={(e) => set("branding_payment", e.target.value || null)} />
        <TextField label="Brandwrap expiry" type="date" value={str(values.brandwrap_expire_date)} onChange={(e) => set("brandwrap_expire_date", e.target.value || null)} />
      </FormSection>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Create vehicle"}
        </button>
      </div>
    </form>
  );
}
