import type { Section, UserPermissionRow } from "@/lib/types";

const SECTIONS: Section[] = [
  "dashboard",
  "daily-logs",
  "vehicles",
  "riders",
  "salary",
  "assignments",
  "attendance",
  "maintenance",
  "financials",
  "reports",
  "expenses",
  "cash-collection",
  "performance",
];

const ACTIONS: (keyof Omit<UserPermissionRow, "section">)[] = ["can_view", "can_create", "can_edit", "can_delete"];

interface PermissionMatrixProps {
  rows: UserPermissionRow[];
  onChange: (rows: UserPermissionRow[]) => void;
}

function emptyRow(section: Section): UserPermissionRow {
  return { section, can_view: false, can_create: false, can_edit: false, can_delete: false };
}

export function PermissionMatrix({ rows, onChange }: PermissionMatrixProps) {
  const bySection = new Map(rows.map((r) => [r.section, r]));

  const setValue = (section: Section, action: keyof Omit<UserPermissionRow, "section">, value: boolean) => {
    const current = bySection.get(section) ?? emptyRow(section);
    const updated = { ...current, [action]: value };
    const next = SECTIONS.map((s) => (s === section ? updated : bySection.get(s) ?? emptyRow(s)));
    onChange(next);
  };

  const grantAll = (section: Section) => {
    const next = SECTIONS.map((s) =>
      s === section ? { section, can_view: true, can_create: true, can_edit: true, can_delete: true } : bySection.get(s) ?? emptyRow(s),
    );
    onChange(next);
  };

  const clearAll = (section: Section) => {
    const next = SECTIONS.map((s) => (s === section ? emptyRow(section) : bySection.get(s) ?? emptyRow(s)));
    onChange(next);
  };

  return (
    <table className="permission-matrix">
      <thead>
        <tr>
          <th>Section</th>
          <th>View</th>
          <th>Create</th>
          <th>Edit</th>
          <th>Delete</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {SECTIONS.map((section) => {
          const row = bySection.get(section) ?? emptyRow(section);
          return (
            <tr key={section}>
              <td>{section.replace(/-/g, " ")}</td>
              {ACTIONS.map((action) => (
                <td key={action}>
                  <input
                    type="checkbox"
                    checked={row[action]}
                    onChange={(e) => setValue(section, action, e.target.checked)}
                  />
                </td>
              ))}
              <td>
                <button type="button" className="link-btn" onClick={() => grantAll(section)} style={{ marginRight: 8 }}>
                  All
                </button>
                <button type="button" className="link-btn" onClick={() => clearAll(section)}>
                  Clear
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export { SECTIONS };
