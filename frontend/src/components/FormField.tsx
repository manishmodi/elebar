import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldWrapperProps {
  label: string;
  required?: boolean | undefined;
  error?: string | undefined;
  children: ReactNode;
  hint?: string | undefined;
}

export function FieldWrapper({ label, required, error, children, hint }: FieldWrapperProps) {
  return (
    <label className="form-field">
      <span className="form-label">
        {label}
        {required && <span className="required-mark">*</span>}
      </span>
      {children}
      {hint && <span className="form-hint">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
    </label>
  );
}

type FieldMeta = Omit<FieldWrapperProps, "children">;

type TextFieldProps = FieldMeta & InputHTMLAttributes<HTMLInputElement>;

export function TextField({ label, required, error, hint, ...rest }: TextFieldProps) {
  return (
    <FieldWrapper label={label} required={required} error={error} hint={hint}>
      <input {...rest} />
    </FieldWrapper>
  );
}

type SelectFieldProps = FieldMeta & SelectHTMLAttributes<HTMLSelectElement>;

export function SelectField({ label, required, error, hint, children, ...rest }: SelectFieldProps) {
  return (
    <FieldWrapper label={label} required={required} error={error} hint={hint}>
      <select {...rest}>{children}</select>
    </FieldWrapper>
  );
}

type TextAreaFieldProps = FieldMeta & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaField({ label, required, error, hint, ...rest }: TextAreaFieldProps) {
  return (
    <FieldWrapper label={label} required={required} error={error} hint={hint}>
      <textarea {...rest} />
    </FieldWrapper>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <div className="form-grid">{children}</div>
    </fieldset>
  );
}
