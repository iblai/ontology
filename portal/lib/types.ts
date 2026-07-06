// Domain model for the Registration & Enrollment Portal.
// See PLAN.md §6. Extend only when a screen needs it.

export type Role =
  | "parent"
  | "student"
  | "afa_admin"
  | "network_admin"
  | "central_admin"
  | "finance_admin";

export const ADMIN_ROLES: Role[] = ["afa_admin", "network_admin", "central_admin", "finance_admin"];

export type ApplicationStatus = // PDF §2.2 — all 11
  | "draft"
  | "submitted"
  | "incomplete"
  | "under_review"
  | "interview_required"
  | "accepted"
  | "declined"
  | "waitlisted"
  | "enrollment_in_progress"
  | "enrolled"
  | "withdrawn";

export type PlacementStatus = // PDF §9.1
  "not_assigned" | "assigned" | "started" | "completed" | "reviewed" | "confirmed";

export type Subject = "math" | "languageArts";

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface Guardian {
  firstName: string;
  lastName: string;
  relationship: string;
  email: string;
  phone: string;
  secondaryPhone?: string;
  address: Address;
}

export interface Signature {
  role: "primary_parent" | "co_parent" | "student";
  signerName: string;
  signature: string;
  signedAt: string;
}

export interface Acknowledgment {
  id: string;
  label: string;
  documentUrl?: string;
  checked: boolean;
  handbookVersion?: string; // PDF §6
}

export interface UploadedDocument {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
  studentId?: string;
}

export interface MedicalRelease {
  // network schools, PDF §4
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  physician?: string;
  insuranceProvider?: string;
  policyNumber?: string;
  treatmentAuthorized: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

export interface PlacementRecord {
  status: PlacementStatus;
  recommendedCourse?: string;
  recommendedStartPoint?: string;
  finalCourse?: string;
  finalStartPoint?: string;
  updatedAt?: string;
}

export interface CourseEnrollment {
  courseId: string;
  courseName: string;
  startDate: string;
  active: boolean;
}

export interface StudentApplication {
  id: string;
  status: ApplicationStatus; // per-student status, PDF §2.2
  legalFirstName: string;
  legalLastName: string;
  preferredName?: string;
  email?: string; // required grades 3–12 (AFA)
  dateOfBirth: string;
  gender: string;
  gradeLevel: string; // 'K'..'12'
  program: string; // id from SchoolConfig.programs
  individualCourse?: string; // AFA "Individual Course" only
  supportInfo: string;
  academicBackground: Record<string, string>; // questionId → answer
  studentResponses?: Record<string, string>; // grades 3–12 only
  photoMediaRelease?: boolean; // network schools
  placement: Record<Subject, PlacementRecord>;
  courseEnrollments: CourseEnrollment[];
}

export interface InternalNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface StatusChange {
  // PDF §2.2: date, time, user
  from: ApplicationStatus;
  to: ApplicationStatus;
  by: string;
  at: string;
  note?: string;
  studentId?: string; // set when per-student
}

export interface DecisionNotice {
  studentIds: string[];
  kind: "acceptance" | "declination" | "waitlist";
  body: string;
  sentAt: string; // PDF §2.4
}

export interface Interview {
  required: boolean;
  notes: InternalNote[]; // NEVER serialized to parents
  outcome?: "proceed" | "request_info" | "decline" | "waitlist";
  completedAt?: string;
  waivedBy?: string;
}

export interface ApplicationFee {
  amountCents: number;
  basis: "family" | "student";
  status: "unpaid" | "paid" | "waived";
  paidAt?: string;
  method?: string;
  refundability: "refundable" | "nonrefundable" | "creditable";
}

export interface Application {
  // one per FAMILY
  id: string; // e.g. 'AFA-2026-0042'
  schoolSlug: string;
  programYear: string;
  status: ApplicationStatus; // family-level rollup
  parentEmail: string;
  guardians: Guardian[]; // 1–2
  familyAnswers: Record<string, string>; // referral/faith/background
  students: StudentApplication[];
  acknowledgments: Acknowledgment[];
  signatures: Signature[];
  medicalRelease?: MedicalRelease;
  documents: UploadedDocument[];
  fee: ApplicationFee;
  interview?: Interview;
  internalNotes: InternalNote[]; // NEVER serialized to parents
  history: StatusChange[];
  decisionNotices: DecisionNotice[];
  infoRequests: InfoRequest[];
  communications: Communication[];
  submittedAt?: string;
  createdAt: string;
  isReenrollment?: boolean;
}

export interface InfoRequest {
  id: string;
  items: string;
  requestedBy: string;
  requestedAt: string;
  resolvedAt?: string;
}

export interface Communication {
  id: string;
  templateId: string;
  subject: string;
  body: string;
  sentBy: string;
  sentAt: string;
}

// ---- Billing (PDF §5, §7) ----
export type ChargeType =
  | "application_fee"
  | "registration_fee"
  | "tuition"
  | "curriculum"
  | "supply"
  | "facility"
  | "lunch"
  | "field_trip"
  | "activity"
  | "technology"
  | "late_fee"
  | "other";

export type FundingSource =
  | "parent"
  | "esa"
  | "sgo"
  | "scholarship"
  | "grant"
  | "third_party"
  | "credit";

export type PaymentPlanKind = "full" | "two_payments" | "quarterly" | "monthly";

export interface PlanInstallment {
  dueDate: string;
  amountCents: number;
  invoiceId?: string;
}

export interface FamilyAccount {
  id: string;
  applicationId: string;
  schoolSlug: string;
  familyName: string;
  plan?: {
    kind: PaymentPlanKind;
    acknowledgedPoliciesAt: string;
    installments: PlanInstallment[];
  };
  ledger: LedgerEntry[]; // charges, payments, credits — the audit log
  hold?: { placedBy: string; placedAt: string; reason: string };
}

export interface LedgerEntry {
  id: string;
  at: string;
  by: string; // admin name or 'parent'
  kind: "charge" | "payment" | "credit" | "refund" | "waiver" | "adjustment";
  chargeType?: ChargeType;
  fundingSource?: FundingSource;
  studentId?: string; // student-level detail, PDF §7
  amountCents: number; // charges positive; payments/credits/refunds/waivers negative
  memo?: string;
}

export interface Invoice {
  id: string;
  accountId: string;
  dueDate: string;
  amountCents: number;
  status: "due" | "paid" | "overdue";
  paidAt?: string;
}

// ---- SIS (PDF §2.5) ----
export interface SisRecord {
  id: string;
  kind: "guardian" | "student";
  familyId: string;
  sourceApplicationId: string;
  fields: Record<string, string>;
  duplicateOfId?: string; // dedupe flag
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  href?: string;
  readAt?: string;
  createdAt: string;
}

// ---- Persisted DB shape (the whole mock store) ----
export interface Db {
  version: number;
  applications: Application[];
  accounts: FamilyAccount[];
  invoices: Invoice[];
  sisRecords: SisRecord[];
  notifications: AppNotification[];
  seq: Record<string, number>; // per-school application counters
}
