// Central domain types mirroring the Django REST API contract.

export type Section =
  | "dashboard"
  | "daily-logs"
  | "vehicles"
  | "riders"
  | "salary"
  | "assignments"
  | "attendance"
  | "maintenance"
  | "financials"
  | "reports"
  | "expenses"
  | "cash-collection"
  | "performance";

export interface SectionPermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export type Permissions = Record<Section, SectionPermission>;

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_admin: boolean;
  permissions: Permissions;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorBody {
  detail?: string;
  errors?: Record<string, string[]>;
}

// ---------- Auth / Users ----------

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface UserPermissionRow {
  section: Section;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface ActivityLog {
  id: string;
  user: string | null;
  user_name: string;
  action: string;
  section: string;
  description: string;
  created_at: string;
}

// ---------- Riders ----------

export type RiderStatus = "active" | "inactive";
export type EmploymentType = "full_time" | "part_time" | "contract";

export interface RiderListItem {
  id: string;
  full_name: string;
  phone_number: string;
  status: RiderStatus;
  employment_type: EmploymentType;
  joining_date: string;
  monthly_salary: string;
  daily_ride_target: number;
  assigned_supervisor: string;
  fleet_pilot: boolean;
  yango_driver_id: string | null;
  created_at: string;
}

export interface Rider extends RiderListItem {
  kyc_submission_date: string | null;
  secondary_phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  blood_group: string | null;
  permanent_address: string | null;
  temporary_address: string | null;
  address: string | null;
  email: string | null;
  emergency_contact: string | null;
  citizenship_number: string | null;
  citizenship_issue_date: string | null;
  citizenship_issue_district: string | null;
  citizenship_image_url: string | null;
  nid_number: string | null;
  nid_issue_date: string | null;
  nid_issue_district: string | null;
  license_number: string | null;
  license_expiry_date: string | null;
  license_issue_date: string | null;
  license_issue_district: string | null;
  license_type: string | null;
  license_image_url: string | null;
  driving_experience: string | null;
  father_name: string | null;
  father_phone: string | null;
  mother_name: string | null;
  mother_phone: string | null;
  spouse_name: string | null;
  spouse_phone: string | null;
  grandfather_name: string | null;
  grandmother_name: string | null;
  family_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  relationship_proof_url: string | null;
  salary_structure: string | null;
  security_deposit: string | null;
  bank_account_details: string | null;
}

export interface RiderStats {
  log_days: number;
  total_rides: number;
  total_income: number;
  avg_rides_per_day: number;
  avg_income_per_day: number;
  growth: { rides: number | null; income: number | null };
}

// ---------- Vehicles ----------

export type VehicleStatus = "active" | "maintenance" | "inactive";

export interface Vehicle {
  id: string;
  vehicle_number: string;
  plate_number: string;
  vehicle_type: string;
  brand: string;
  model: string;
  manufacture_year: number | null;
  color: string | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  battery_details: string | null;
  insurance_issue_date: string | null;
  insurance_expiry: string | null;
  tax_expiry: string | null;
  service_due_date: string | null;
  last_service_date: string | null;
  last_service_odometer: number | null;
  servicing_payment: string | null;
  odometer_reading: string | null;
  status: VehicleStatus;
  location_branch: string | null;
  gps_installed: string | null;  // legacy text column: "yes"/"no"/""
  gps_number: string | null;
  gps_id_password: string | null;
  scooter_branding: string | null;
  yango_branding_date: string | null;
  branding_payment: string | null;
  brandwrap_expire_date: string | null;
  bluebook_issue_date: string | null;
  bluebook_expiry_date: string | null;
  in_servicing_since: string | null;
}

// ---------- Assignments ----------

export type ShiftType = "morning" | "day" | "evening" | "night";
export type AssignmentStatus = "active" | "ended";

export interface Assignment {
  id: string;
  rider: string;
  rider_name?: string;
  vehicle: string;
  vehicle_number?: string;
  plate_number?: string;
  start_date: string;
  end_date: string | null;
  shift_type: ShiftType;
  status: AssignmentStatus;
}

// ---------- Daily logs ----------

export interface DailyLog {
  id: string;
  rider: string;
  rider_name?: string;
  vehicle: string;
  vehicle_number?: string;
  nepali_date: string | null;
  english_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  daily_bonus_set: string | null;
  total_rides_received: number | null;
  rides_completed: number | null;
  acceptance_rate: string | null;
  bonus_target_completion: boolean | null;
  total_ride_distance_km: string | null;
  total_ride_hours: string | null;
  total_app_online: string | null;
  cash_as_per_app: string | null;
  goal_bonus: string | null;
  promotion_bonus_other: string | null;
  total_income: string | null;
  cash_given_by_driver: string | null;
  cash_transferred_online: string | null;
  cash_check: string | null;
  daily_allowance: string | null;
  additional_expenses: string | null;
  remarks: string | null;
  is_draft: boolean;
  yango_synced_at: string | null;
}

// ---------- Attendance ----------

export type AttendanceType = "present" | "absent" | "leave" | "holiday" | "half_day";

export interface Attendance {
  id: string;
  rider: string;
  rider_name?: string;
  date: string;
  nepali_date: string | null;
  type: AttendanceType;
  remarks: string | null;
  vehicle: string | null;
  vehicle_number?: string;
  battery_out: number | null;
  battery_in: number | null;
  scooter_out: string | null;
  scooter_in: string | null;
  rider_time_in: string | null;
  rider_time_out: string | null;
  morning_odometer: number | null;
  evening_odometer: number | null;
  vehicle_override_reason: string | null;
  day_closed: boolean;
}

// ---------- Handovers ----------

export type HandoverKind = "checkout" | "exchange" | "checkin";
export type HandoverStatus = "pending" | "verified" | "rejected";

export interface Handover {
  id: string;
  rider: string;
  rider_name: string;
  english_date: string;
  kind: HandoverKind;
  status: HandoverStatus;
  payload: Record<string, unknown>;
  vehicle: string | null;
  vehicle_number: string | null;
  cash_expected: string | null;
  cash_variance: string | null;
  submitted_at: string;
}

// ---------- Maintenance ----------

export type MaintenanceType =
  | "battery_service"
  | "tire_replacement"
  | "brake_service"
  | "electrical_repair"
  | "accident_repair";

export interface MaintenanceRecord {
  id: string;
  vehicle: string;
  vehicle_number?: string;
  maintenance_type: MaintenanceType;
  date: string;
  cost: string;
  description: string | null;
  next_service_date: string | null;
}

export type ServiceStatus = "ok" | "due_soon" | "overdue" | "unknown";

export interface ServicingStatusRow {
  vehicle: string;
  vehicle_number: string;
  plate_number: string;
  status: VehicleStatus;
  in_servicing_since: string | null;
  current_odometer: number | null;
  last_service_odometer: number | null;
  last_service_date: string | null;
  km_since_service: number | null;
  km_until_due: number | null;
  service_status: ServiceStatus;
}

export interface ServicingHistoryEntry {
  id: string;
  vehicle: string;
  vehicle_number?: string;
  service_date: string;
  odometer_at_service: number;
  notes: string | null;
  cost: string;
}

// ---------- Dashboard ----------

export interface DashboardSummary {
  vehicles: { total: number; active: number; maintenance: number };
  riders: { total: number; active: number };
  today: { rides: number; income: number };
  month: { rides: number; income: number };
}

export interface FleetStatsDay {
  english_date: string;
  rides: number;
  income: number;
  vehicles: number;
}

export interface FleetStats {
  total_rides: number;
  total_income: number;
  days: number;
  daily: FleetStatsDay[];
  growth: { income: number | null; rides: number | null } | null;
}

// ---------- Salary ----------

export type PayModel = "legacy" | "vpe";

export interface PendingAdvance {
  id: string;
  date: string;
  amount: string;
  notes: string | null;
}

export interface SalaryCalculation {
  rider: string;
  rider_name: string;
  pay_model: PayModel;
  days_worked: number;
  times_target_missed: number;
  flagged: boolean;
  // The calculate endpoint is a plain APIView: Decimals arrive as JSON numbers,
  // unlike the string money on paginated serializer endpoints.
  base_salary: number;
  total_allowances: number;
  total_advances: number;
  total_cash_variance: number;
  final_salary: number;
  floor_applied: boolean;
  pending_advances: PendingAdvance[];
}

export interface SalaryPayment {
  id: string;
  rider: string;
  rider_name?: string;
  period_from: string;
  period_to: string;
  salary_processed: string;
  notes: string | null;
  created_at: string;
  voided?: boolean;
}

export interface SalaryProcessError {
  rider: string;
  detail: string;
}

export interface SalaryProcessResponse {
  processed: SalaryPayment[];
  errors: SalaryProcessError[];
}

export interface Advance {
  id: string;
  rider: string;
  rider_name?: string;
  date: string;
  amount: string;
  notes: string | null;
  applied?: boolean;
}

export interface PayConfigRow {
  id: string;
  parameter: string;
  value: string;
  effective_from: string;
}

export interface PayConfig {
  rows: PayConfigRow[];
  defaults: Record<string, string>;
}

// ---------- Expenses ----------

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
}

export interface Expense {
  id: string;
  category: string;
  category_name?: string;
  date: string;
  amount: string;
  notes: string | null;
  rider: string | null;
  rider_name?: string;
  vehicle: string | null;
  vehicle_number?: string;
  created_by?: string;
}

// ---------- Cash collection ----------

export type ApprovalStatus = "pending" | "approved" | "disapproved";

export interface CashCollection {
  id: string;
  rider: string;
  rider_name?: string;
  english_date: string;
  nepali_date: string | null;
  denom_1000: number;
  denom_500: number;
  denom_100: number;
  denom_50: number;
  denom_20: number;
  denom_10: number;
  wallet_amount: string;
  note: string | null;
  cash_total: string;
  grand_total: string;
  approval_status: ApprovalStatus;
  submitted_by_name: string;
  submitted_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  approval_note: string | null;
  cash_expected?: string;
  cash_variance?: string;
}

// ---------- Performance ----------

export type Tier = "A+" | "A" | "B" | "C" | "D" | "Inactive";

export interface PerformanceRow {
  rider: string;
  rider_name: string;
  days: number;
  total_rides: number;
  total_revenue: number;
  avg_rides_per_day: number;
  avg_revenue_per_day: number;
  avg_acceptance: number | null;
  target_hit_rate: number | null;
  fraud_days: number;
  tier: Tier;
  flags: string[];
}

export interface PerformanceResponse {
  riders: PerformanceRow[];
  tier_distribution: Record<string, number>;
}

export interface PerformanceDayRow {
  date: string;
  rides_completed: number;
  rides_received: number;
  target: number;
  income: number;
  goal_bonus: number;
  cash_check: number;
  acceptance_rate: number;
}

// ---------- Yango ----------

export interface YangoStatus {
  configured: boolean;
}

// GET /api/yango/drivers/ rows — driver directory cached from the park's
// full driver list (see apps/operations/yango_sync.py:refresh_driver_cache_now).
export interface YangoDriver {
  driver_profile_id: string;
  name: string;
  phones?: string[];
}

export interface YangoDriverCacheState {
  ready: boolean;
  loading: boolean;
  total: number;
  loaded_at: string | null;
  error: string | null;
}

export interface YangoDriversResponse {
  drivers: YangoDriver[];
  cache: YangoDriverCacheState;
}

export interface YangoDriversRefreshResponse {
  detail: string;
  cache: YangoDriverCacheState;
}

export type YangoSyncJobStatus = "running" | "done" | "error";

// Per-rider status from preview_for_date: "new"/"draft_exists" carry figures,
// "finalized_exists" reports an already-confirmed log (never overwritten),
// "error" carries `error` instead of figures.
export type YangoPreviewRowStatus = "new" | "draft_exists" | "finalized_exists" | "error";

export interface YangoSyncPreviewRow {
  rider_id: string;
  rider_name: string;
  yango_driver_id: string;
  status: YangoPreviewRowStatus;
  existing_log_id?: string;
  error?: string;
  rides_completed?: number;
  total_rides_received?: number;
  acceptance_rate?: string;
  total_ride_distance_km?: string;
  total_income?: string;
  cash_as_per_app?: string;
  goal_bonus?: string;
  promotion_bonus_other?: string;
  total_app_online?: string;
}

export interface YangoSyncPreviewResult {
  date: string;
  riders: YangoSyncPreviewRow[];
}

export interface YangoSyncPreviewProgress {
  completed: number;
  total: number;
}

// POST /sync/preview/start/ and GET /sync/preview/status/<job_id>/ share this
// shape; `result`/`error` only populate once status leaves "running".
export interface YangoSyncPreviewJob {
  job_id: string;
  date: string;
  status: YangoSyncJobStatus;
  progress: YangoSyncPreviewProgress;
  result?: YangoSyncPreviewResult;
  error?: string;
}

// POST /api/yango/sync/ {job_id} response — counts dict from persist_from_preview.
export interface YangoSyncPersistResult {
  date: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}
