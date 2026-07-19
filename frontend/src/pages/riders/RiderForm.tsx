import { useEffect, useState, type FormEvent } from "react";
import { api, openAuthenticatedFile } from "@/lib/api";
import { useToast, apiErrorMessage } from "@/contexts/toast";
import { FormSection, TextField, SelectField, TextAreaField } from "@/components/FormField";
import type { Rider } from "@/lib/types";

export type RiderFormValues = Omit<Rider, "id" | "created_at">;

const EMPTY: RiderFormValues = {
  full_name: "",
  phone_number: "",
  status: "active",
  employment_type: "full_time",
  joining_date: "",
  monthly_salary: "0",
  daily_ride_target: 0,
  assigned_supervisor: "",
  fleet_pilot: false,
  yango_driver_id: null,
  kyc_submission_date: null,
  secondary_phone: null,
  date_of_birth: null,
  gender: null,
  marital_status: null,
  blood_group: null,
  permanent_address: null,
  temporary_address: null,
  address: null,
  email: null,
  emergency_contact: null,
  citizenship_number: null,
  citizenship_issue_date: null,
  citizenship_issue_district: null,
  citizenship_image_url: null,
  nid_number: null,
  nid_issue_date: null,
  nid_issue_district: null,
  license_number: null,
  license_expiry_date: null,
  license_issue_date: null,
  license_issue_district: null,
  license_type: null,
  license_image_url: null,
  driving_experience: null,
  father_name: null,
  father_phone: null,
  mother_name: null,
  mother_phone: null,
  spouse_name: null,
  spouse_phone: null,
  grandfather_name: null,
  grandmother_name: null,
  family_address: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  emergency_contact_relationship: null,
  relationship_proof_url: null,
  salary_structure: null,
  security_deposit: null,
  bank_account_details: null,
};

interface RiderFormProps {
  initial?: Rider | null;
  onSubmit: (values: RiderFormValues) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

function str(v: string | null | undefined): string {
  return v ?? "";
}

function FileUploadField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (url: string) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.upload<{ object_path: string }>(
        `/api/storage/upload/?name=${encodeURIComponent(file.name)}`,
        file,
      );
      onChange(res.object_path);
      toast.success(`${label} uploaded.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Upload failed."));
    } finally {
      setUploading(false);
    }
  };

  const handleView = async () => {
    try {
      await openAuthenticatedFile(`/api/storage${value}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not open file."));
    }
  };

  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      <input type="file" onChange={(e) => void handleFile(e.target.files?.[0])} disabled={uploading} />
      {value && (
        <span className="form-hint">
          Uploaded.{" "}
          <button type="button" className="link-btn" onClick={() => void handleView()}>
            View file
          </button>
        </span>
      )}
      {uploading && <span className="form-hint">Uploading…</span>}
    </label>
  );
}

export function RiderForm({ initial, onSubmit, onCancel, submitting }: RiderFormProps) {
  const [values, setValues] = useState<RiderFormValues>(EMPTY);

  useEffect(() => {
    if (initial) {
      const { id: _id, created_at: _createdAt, ...rest } = initial;
      setValues(rest);
    } else {
      setValues(EMPTY);
    }
  }, [initial]);

  const set = <K extends keyof RiderFormValues>(key: K, value: RiderFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit}>
      <FormSection title="Personal information">
        <TextField label="Full name" required value={values.full_name} onChange={(e) => set("full_name", e.target.value)} />
        <TextField label="Phone number" required value={values.phone_number} onChange={(e) => set("phone_number", e.target.value)} />
        <TextField label="Secondary phone" value={str(values.secondary_phone)} onChange={(e) => set("secondary_phone", e.target.value || null)} />
        <TextField label="Email" type="email" value={str(values.email)} onChange={(e) => set("email", e.target.value || null)} />
        <TextField label="Date of birth" type="date" value={str(values.date_of_birth)} onChange={(e) => set("date_of_birth", e.target.value || null)} />
        <TextField label="Gender" value={str(values.gender)} onChange={(e) => set("gender", e.target.value || null)} />
        <TextField label="Marital status" value={str(values.marital_status)} onChange={(e) => set("marital_status", e.target.value || null)} />
        <TextField label="Blood group" value={str(values.blood_group)} onChange={(e) => set("blood_group", e.target.value || null)} />
        <TextAreaField label="Permanent address" value={str(values.permanent_address)} onChange={(e) => set("permanent_address", e.target.value || null)} />
        <TextAreaField label="Temporary address" value={str(values.temporary_address)} onChange={(e) => set("temporary_address", e.target.value || null)} />
        <TextAreaField label="Current address" value={str(values.address)} onChange={(e) => set("address", e.target.value || null)} />
        <TextField label="Emergency contact (general)" value={str(values.emergency_contact)} onChange={(e) => set("emergency_contact", e.target.value || null)} />
      </FormSection>

      <FormSection title="Identification">
        <TextField label="KYC submission date" type="date" value={str(values.kyc_submission_date)} onChange={(e) => set("kyc_submission_date", e.target.value || null)} />
        <TextField label="Citizenship number" value={str(values.citizenship_number)} onChange={(e) => set("citizenship_number", e.target.value || null)} />
        <TextField label="Citizenship issue date" type="date" value={str(values.citizenship_issue_date)} onChange={(e) => set("citizenship_issue_date", e.target.value || null)} />
        <TextField label="Citizenship issue district" value={str(values.citizenship_issue_district)} onChange={(e) => set("citizenship_issue_district", e.target.value || null)} />
        <FileUploadField label="Citizenship image" value={values.citizenship_image_url} onChange={(url) => set("citizenship_image_url", url)} />
        <TextField label="NID number" value={str(values.nid_number)} onChange={(e) => set("nid_number", e.target.value || null)} />
        <TextField label="NID issue date" type="date" value={str(values.nid_issue_date)} onChange={(e) => set("nid_issue_date", e.target.value || null)} />
        <TextField label="NID issue district" value={str(values.nid_issue_district)} onChange={(e) => set("nid_issue_district", e.target.value || null)} />
      </FormSection>

      <FormSection title="License">
        <TextField label="License number" value={str(values.license_number)} onChange={(e) => set("license_number", e.target.value || null)} />
        <TextField label="License type" value={str(values.license_type)} onChange={(e) => set("license_type", e.target.value || null)} />
        <TextField label="License issue date" type="date" value={str(values.license_issue_date)} onChange={(e) => set("license_issue_date", e.target.value || null)} />
        <TextField label="License expiry date" type="date" value={str(values.license_expiry_date)} onChange={(e) => set("license_expiry_date", e.target.value || null)} />
        <TextField label="License issue district" value={str(values.license_issue_district)} onChange={(e) => set("license_issue_district", e.target.value || null)} />
        <TextField label="Driving experience" value={str(values.driving_experience)} onChange={(e) => set("driving_experience", e.target.value || null)} />
        <FileUploadField label="License image" value={values.license_image_url} onChange={(url) => set("license_image_url", url)} />
      </FormSection>

      <FormSection title="Family & emergency contact">
        <TextField label="Father's name" value={str(values.father_name)} onChange={(e) => set("father_name", e.target.value || null)} />
        <TextField label="Father's phone" value={str(values.father_phone)} onChange={(e) => set("father_phone", e.target.value || null)} />
        <TextField label="Mother's name" value={str(values.mother_name)} onChange={(e) => set("mother_name", e.target.value || null)} />
        <TextField label="Mother's phone" value={str(values.mother_phone)} onChange={(e) => set("mother_phone", e.target.value || null)} />
        <TextField label="Spouse name" value={str(values.spouse_name)} onChange={(e) => set("spouse_name", e.target.value || null)} />
        <TextField label="Spouse phone" value={str(values.spouse_phone)} onChange={(e) => set("spouse_phone", e.target.value || null)} />
        <TextField label="Grandfather's name" value={str(values.grandfather_name)} onChange={(e) => set("grandfather_name", e.target.value || null)} />
        <TextField label="Grandmother's name" value={str(values.grandmother_name)} onChange={(e) => set("grandmother_name", e.target.value || null)} />
        <TextAreaField label="Family address" value={str(values.family_address)} onChange={(e) => set("family_address", e.target.value || null)} />
        <TextField label="Emergency contact name" value={str(values.emergency_contact_name)} onChange={(e) => set("emergency_contact_name", e.target.value || null)} />
        <TextField label="Emergency contact phone" value={str(values.emergency_contact_phone)} onChange={(e) => set("emergency_contact_phone", e.target.value || null)} />
        <TextField label="Relationship" value={str(values.emergency_contact_relationship)} onChange={(e) => set("emergency_contact_relationship", e.target.value || null)} />
        <FileUploadField label="Relationship proof" value={values.relationship_proof_url} onChange={(url) => set("relationship_proof_url", url)} />
      </FormSection>

      <FormSection title="Employment & pay">
        <TextField label="Joining date" type="date" required value={str(values.joining_date)} onChange={(e) => set("joining_date", e.target.value)} />
        <SelectField label="Employment type" value={values.employment_type} onChange={(e) => set("employment_type", e.target.value as RiderFormValues["employment_type"])}>
          <option value="full_time">Full time</option>
          <option value="part_time">Part time</option>
          <option value="contract">Contract</option>
        </SelectField>
        <SelectField label="Status" value={values.status} onChange={(e) => set("status", e.target.value as RiderFormValues["status"])}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </SelectField>
        <TextField label="Salary structure" value={str(values.salary_structure)} onChange={(e) => set("salary_structure", e.target.value || null)} />
        <TextField label="Monthly salary" type="number" step="0.01" value={values.monthly_salary} onChange={(e) => set("monthly_salary", e.target.value)} />
        <TextField label="Daily ride target" type="number" value={values.daily_ride_target} onChange={(e) => set("daily_ride_target", Number(e.target.value))} />
        <TextField label="Security deposit" type="number" step="0.01" value={str(values.security_deposit)} onChange={(e) => set("security_deposit", e.target.value || null)} />
        <TextField label="Assigned supervisor" value={values.assigned_supervisor} onChange={(e) => set("assigned_supervisor", e.target.value)} />
        <TextAreaField label="Bank account details" value={str(values.bank_account_details)} onChange={(e) => set("bank_account_details", e.target.value || null)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={values.fleet_pilot} onChange={(e) => set("fleet_pilot", e.target.checked)} />
          Fleet pilot
        </label>
        <TextField label="Yango driver ID" value={str(values.yango_driver_id)} onChange={(e) => set("yango_driver_id", e.target.value || null)} />
      </FormSection>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Create rider"}
        </button>
      </div>
    </form>
  );
}
