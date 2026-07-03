import type { PaymentPlanKind } from "../types";

export type QuestionKind = "text" | "textarea" | "select" | "yesno";

export interface Question {
  id: string;
  label: string;
  kind: QuestionKind;
  options?: string[];
  required?: boolean;
}

export interface Program {
  id: string;
  label: string;
  description?: string;
  requiresCourseSelection?: boolean;
}

export interface AgreementConfig {
  id: string;
  label: string;
  documentUrl?: string;
  required: boolean;
}

export interface SchoolConfig {
  slug: string;
  name: string;
  shortName: string;
  logo: string; // path under /public
  accentColor: string; // hex, applied only on the public apply route
  model: "afa" | "network";
  programYear: string; // e.g. '2026-2027'
  intro: string;
  announcements: string[];

  programs: Program[];
  /** Referral + faith/background questions shown on the Family step. */
  familyQuestions: Question[];
  academicBackgroundQuestions: Question[];
  /** Grades 3–12 only. */
  studentResponseQuestions: Question[];

  agreements: AgreementConfig[];
  signatures: { primaryParent: true; coParent: boolean; student: boolean };
  requiresMedicalRelease: boolean;
  requiresPhotoMediaRelease: boolean;
  interviewRequiredByDefault: boolean; // PDF §2.3

  fee: {
    amountCents: number;
    basis: "family" | "student";
    refundability: "refundable" | "nonrefundable" | "creditable";
    lateFeeCents?: number;
    lateFeeAfter?: string; // ISO date
  };

  handbook: { url: string; version: string };
  decisionTemplates: Record<"acceptance" | "declination" | "waitlist", string>;
  tuition: { gradeBand: string; programId: string; annualCents: number }[];
  planKinds: PaymentPlanKind[];
  /** Additional per-student fees offered on the billing config. PDF §7. */
  standardFees: { chargeType: string; label: string; amountCents: number }[];
  reenrollmentWindow?: { opens: string; deadline: string };
}

export const GRADE_LEVELS = [
  "K",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
] as const;

/** Grades that see the student-response question set (PDF §3, §4). */
export function showsStudentResponses(gradeLevel: string): boolean {
  return gradeLevel !== "K" && gradeLevel !== "1" && gradeLevel !== "2";
}
