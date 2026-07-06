import type { Application } from "../types";

// Applicant communication templates — PDF §12 (nice-to-have list).
export const COMMUNICATION_TEMPLATES = [
  {
    id: "incomplete_application",
    label: "Incomplete application",
    subject: "Your application is incomplete",
    body: "Dear {{parentName}}, your application {{applicationId}} is missing required items. Please sign in to the portal to complete it.",
  },
  {
    id: "missing_documents",
    label: "Missing documents",
    subject: "Documents needed for your application",
    body: "Dear {{parentName}}, we still need one or more documents to continue reviewing application {{applicationId}}. Please upload them in the portal.",
  },
  {
    id: "missing_waiver",
    label: "Missing waiver",
    subject: "Outstanding waiver on your application",
    body: "Dear {{parentName}}, one or more required waivers on application {{applicationId}} have not been signed yet.",
  },
  {
    id: "fee_not_paid",
    label: "Application fee not paid",
    subject: "Application fee outstanding",
    body: "Dear {{parentName}}, the application fee for {{applicationId}} has not been received. The application cannot be reviewed until it is paid or waived.",
  },
  {
    id: "interview_required",
    label: "Interview required",
    subject: "Family interview requested",
    body: "Dear {{parentName}}, as part of our admissions process we would like to schedule a family interview for {{studentNames}}. We will contact you shortly.",
  },
  {
    id: "acceptance",
    label: "Acceptance",
    subject: "Admissions decision",
    body: "Dear {{parentName}}, congratulations — {{studentNames}} has been accepted. Please sign in to the portal to complete enrollment.",
  },
  {
    id: "declination",
    label: "Declination",
    subject: "Admissions decision",
    body: "Dear {{parentName}}, we are unable to offer {{studentNames}} a place at this time. Thank you for applying.",
  },
  {
    id: "waitlist",
    label: "Waitlist",
    subject: "Waitlist notification",
    body: "Dear {{parentName}}, {{studentNames}} has been placed on the waitlist. We will contact you if a place becomes available.",
  },
  {
    id: "enrollment_steps",
    label: "Enrollment steps incomplete",
    subject: "Complete your enrollment",
    body: "Dear {{parentName}}, enrollment steps for {{studentNames}} are incomplete. Please sign in to the portal to finish them.",
  },
  {
    id: "payment_plan_needed",
    label: "Payment plan needed",
    subject: "Select a payment plan",
    body: "Dear {{parentName}}, please select a payment plan to continue enrollment for {{studentNames}}.",
  },
  {
    id: "placement_test_assigned",
    label: "Placement test assigned",
    subject: "Placement testing assigned",
    body: "Dear {{parentName}}, placement testing has been assigned to {{studentNames}}. Students can start from their dashboard.",
  },
] as const;

export type CommunicationTemplateId = (typeof COMMUNICATION_TEMPLATES)[number]["id"];

/** Fill {{parentName}} / {{studentNames}} / {{programYear}} / {{applicationId}} placeholders. */
export function renderTemplate(template: string, app: Application, studentIds?: string[]): string {
  const g = app.guardians[0];
  const parentName = g ? `${g.firstName} ${g.lastName}` : "Family";
  const students = studentIds?.length
    ? app.students.filter((s) => studentIds.includes(s.id))
    : app.students;
  const studentNames = students.map((s) => s.legalFirstName).join(", ") || "your student";
  return template
    .replaceAll("{{parentName}}", parentName)
    .replaceAll("{{studentNames}}", studentNames)
    .replaceAll("{{programYear}}", app.programYear)
    .replaceAll("{{applicationId}}", app.id);
}
