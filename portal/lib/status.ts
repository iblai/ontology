import type { Application, ApplicationStatus } from "./types";

// PDF §2.2 status machine. Legal transitions only; drives the admin dropdowns.
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "incomplete", "withdrawn"],
  incomplete: ["submitted", "under_review", "withdrawn"],
  under_review: [
    "interview_required",
    "accepted",
    "declined",
    "waitlisted",
    "incomplete",
    "withdrawn",
  ],
  interview_required: ["under_review", "accepted", "declined", "waitlisted", "withdrawn"],
  accepted: ["enrollment_in_progress", "withdrawn", "waitlisted"],
  waitlisted: ["accepted", "declined", "withdrawn"], // PDF §2.4: waitlist → accepted before SIS
  declined: [],
  enrollment_in_progress: ["enrolled", "withdrawn"],
  enrolled: ["withdrawn"],
  withdrawn: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that create/refresh SIS records + a family billing account. PDF §2.5. */
export const SIS_CREATING_STATUSES: ApplicationStatus[] = [
  "accepted",
  "enrollment_in_progress",
  "enrolled",
];

export interface SubmitReadiness {
  ready: boolean;
  missing: string[]; // human-readable list of what's blocking submission
}

/**
 * PDF §2.1 / §5.1: an application can only be submitted when required
 * acknowledgments are checked, required signatures are present, and the fee is
 * paid or waived.
 */
export function submitReadiness(app: Application): SubmitReadiness {
  const missing: string[] = [];

  const uncheckedAcks = app.acknowledgments.filter((a) => !a.checked);
  if (uncheckedAcks.length > 0) {
    missing.push(`${uncheckedAcks.length} agreement(s) not acknowledged`);
  }

  const hasPrimarySignature = app.signatures.some(
    (s) => s.role === "primary_parent" && s.signature.trim().length > 0,
  );
  if (!hasPrimarySignature) missing.push("Parent/guardian signature missing");

  if (app.students.length === 0) missing.push("No students added");

  if (app.fee.amountCents > 0 && app.fee.status === "unpaid") {
    missing.push("Application fee not paid");
  }

  return { ready: missing.length === 0, missing };
}

/**
 * PDF §2.3: a family cannot move to acceptance until an interview requirement is
 * completed (outcome === 'proceed') or explicitly waived by an administrator.
 */
export function interviewBlocksAcceptance(app: Application): boolean {
  const iv = app.interview;
  if (!iv || !iv.required) return false;
  if (iv.waivedBy) return false;
  return iv.outcome !== "proceed";
}
