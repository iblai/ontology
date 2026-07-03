// Mock API — the ONLY module components may use for data access.
// Function shapes mirror the future REST API (see PLAN.md §8); the backend swap
// replaces bodies with fetch calls. All functions are async and return copies.

import type {
  Application,
  ApplicationStatus,
  AppNotification,
  Db,
  FamilyAccount,
  Interview,
  Invoice,
  LedgerEntry,
  PaymentPlanKind,
  PlanInstallment,
  Role,
  Signature,
  SisRecord,
  StatusChange,
  StudentApplication,
  Subject,
} from "../types";
import {
  canTransition,
  interviewBlocksAcceptance,
  SIS_CREATING_STATUSES,
  submitReadiness,
} from "../status";
import { getSchoolConfig, listSchoolConfigs } from "../schools";
import type { SchoolConfig } from "../schools/types";
import { clone, mutate, now, query, resetDb, uid } from "./store";
import { COMMUNICATION_TEMPLATES, type CommunicationTemplateId, renderTemplate } from "./templates";

export { COMMUNICATION_TEMPLATES };

// ---- actor (set by SessionProvider; a real backend derives this from the token) ----

export interface Actor {
  id: string;
  name: string;
  role: Role;
  email?: string;
  schoolSlug?: string;
  studentId?: string;
}

let actor: Actor | null = null;

export function setActor(a: Actor | null): void {
  actor = a;
}

function actorName(): string {
  return actor?.name ?? "System";
}

function isSchoolScoped(): string | null {
  if (!actor) return null;
  if (actor.role === "afa_admin") return "afa";
  if (actor.role === "network_admin") return actor.schoolSlug ?? null;
  return null; // central_admin / finance_admin see all schools
}

// ---- family-safe projection (PDF §2.2/§2.3: internal notes never reach families) ----

export interface FamilyApplicationView extends Omit<
  Application,
  "internalNotes" | "interview" | "history"
> {
  interview?: { required: boolean; completedAt?: string; waived: boolean };
  history: Omit<StatusChange, "note">[];
}

function toFamilyView(app: Application): FamilyApplicationView {
  const { internalNotes: _n, interview, history, ...rest } = clone(app);
  void _n;
  return {
    ...rest,
    interview: interview
      ? {
          required: interview.required,
          completedAt: interview.completedAt,
          waived: Boolean(interview.waivedBy),
        }
      : undefined,
    history: history.map(({ note: _note, ...h }) => {
      void _note;
      return h;
    }),
  };
}

// ---- schools ----

export async function listSchools(): Promise<SchoolConfig[]> {
  return clone(listSchoolConfigs());
}

export async function getSchool(slug: string): Promise<SchoolConfig> {
  const cfg = getSchoolConfig(slug);
  if (!cfg) throw new Error(`Unknown school: ${slug}`);
  return clone(cfg);
}

// ---- application lifecycle ----

function findApp(db: Db, id: string): Application {
  const app = db.applications.find((a) => a.id === id);
  if (!app) throw new Error(`Application ${id} not found`);
  return app;
}

function feeAmount(cfg: SchoolConfig, numStudents: number): number {
  const base =
    cfg.fee.basis === "student"
      ? cfg.fee.amountCents * Math.max(numStudents, 1)
      : cfg.fee.amountCents;
  const late =
    cfg.fee.lateFeeCents && cfg.fee.lateFeeAfter && now() > cfg.fee.lateFeeAfter
      ? cfg.fee.lateFeeCents
      : 0;
  return base + late;
}

function blankStudent(): StudentApplication {
  return {
    id: `stu_${uid().slice(0, 8)}`,
    status: "draft",
    legalFirstName: "",
    legalLastName: "",
    dateOfBirth: "",
    gender: "",
    gradeLevel: "",
    program: "",
    supportInfo: "",
    academicBackground: {},
    placement: {
      math: { status: "not_assigned" },
      languageArts: { status: "not_assigned" },
    },
    courseEnrollments: [],
  };
}

export async function createDraft(
  schoolSlug: string,
  email: string,
): Promise<FamilyApplicationView> {
  const cfg = await getSchool(schoolSlug);
  return mutate((db) => {
    db.seq[schoolSlug] = (db.seq[schoolSlug] ?? 0) + 1;
    const id = `${cfg.shortName.toUpperCase()}-2026-${String(db.seq[schoolSlug]).padStart(4, "0")}`;
    const app: Application = {
      id,
      schoolSlug,
      programYear: cfg.programYear,
      status: "draft",
      parentEmail: email.trim().toLowerCase(),
      guardians: [],
      familyAnswers: {},
      students: [blankStudent()],
      acknowledgments: cfg.agreements.map((a) => ({
        id: a.id,
        label: a.label,
        documentUrl: a.documentUrl,
        checked: false,
        handbookVersion: a.id.includes("handbook") ? cfg.handbook.version : undefined,
      })),
      signatures: [],
      documents: [],
      fee: {
        amountCents: feeAmount(cfg, 1),
        basis: cfg.fee.basis,
        status: "unpaid",
        refundability: cfg.fee.refundability,
      },
      interview: cfg.interviewRequiredByDefault ? { required: true, notes: [] } : undefined,
      internalNotes: [],
      history: [],
      decisionNotices: [],
      infoRequests: [],
      communications: [],
      createdAt: now(),
    };
    db.applications.push(app);
    return toFamilyView(app);
  });
}

export async function getDraftsByEmail(email: string): Promise<FamilyApplicationView[]> {
  const e = email.trim().toLowerCase();
  return query((db) =>
    db.applications.filter((a) => a.parentEmail === e && a.status === "draft").map(toFamilyView),
  );
}

export type DraftPatch = Partial<
  Pick<
    Application,
    "guardians" | "familyAnswers" | "students" | "acknowledgments" | "signatures" | "medicalRelease"
  >
>;

export async function updateDraft(id: string, patch: DraftPatch): Promise<FamilyApplicationView> {
  return mutate((db) => {
    const app = findApp(db, id);
    if (app.status !== "draft" && app.status !== "incomplete") {
      throw new Error("Only draft or incomplete applications can be edited");
    }
    Object.assign(app, clone(patch));
    // Keep the fee in sync with the student count for per-student fees.
    const cfg = getSchoolConfig(app.schoolSlug)!;
    if (app.fee.status === "unpaid") {
      app.fee.amountCents = feeAmount(cfg, app.students.length);
    }
    return toFamilyView(app);
  });
}

export async function payFee(id: string, method = "card"): Promise<FamilyApplicationView> {
  // ponytail: mock processor — any card succeeds. Swap for Stripe checkout.
  return mutate((db) => {
    const app = findApp(db, id);
    app.fee.status = "paid";
    app.fee.paidAt = now();
    app.fee.method = method;
    return toFamilyView(app);
  });
}

export async function waiveFee(id: string, reason: string): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    app.fee.status = "waived";
    app.internalNotes.push({
      id: uid(),
      author: actorName(),
      body: `Application fee waived: ${reason}`,
      createdAt: now(),
    });
  });
}

export async function submitApplication(id: string): Promise<FamilyApplicationView> {
  return mutate((db) => {
    const app = findApp(db, id);
    const readiness = submitReadiness(app);
    if (!readiness.ready) {
      throw new Error(`Cannot submit: ${readiness.missing.join("; ")}`);
    }
    applyTransition(app, "submitted", app.parentEmail);
    app.submittedAt = now();
    return toFamilyView(app);
  });
}

// ---- reads ----

export interface ApplicationFilter {
  schoolSlug?: string;
  status?: ApplicationStatus;
  search?: string;
}

export async function listApplications(filter: ApplicationFilter = {}): Promise<Application[]> {
  const scoped = isSchoolScoped();
  return query((db) =>
    db.applications.filter((a) => {
      if (scoped && a.schoolSlug !== scoped) return false;
      if (filter.schoolSlug && a.schoolSlug !== filter.schoolSlug) return false;
      if (filter.status && a.status !== filter.status) return false;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        const hay = [
          a.id,
          ...a.guardians.map((g) => `${g.firstName} ${g.lastName}`),
          ...a.students.map((s) => `${s.legalFirstName} ${s.legalLastName}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }),
  );
}

export async function getApplication(id: string): Promise<Application> {
  const scoped = isSchoolScoped();
  return query((db) => {
    const app = findApp(db, id);
    if (scoped && app.schoolSlug !== scoped) {
      throw new Error("Not authorized for this school");
    }
    return app;
  });
}

export async function getApplicationForFamily(id: string): Promise<FamilyApplicationView> {
  return query((db) => toFamilyView(findApp(db, id)));
}

export async function getFamilyApplications(email: string): Promise<FamilyApplicationView[]> {
  const e = email.trim().toLowerCase();
  return query((db) => db.applications.filter((a) => a.parentEmail === e).map(toFamilyView));
}

export async function findStudent(
  studentId: string,
): Promise<{ app: Application; student: StudentApplication } | null> {
  return query((db) => {
    for (const app of db.applications) {
      const student = app.students.find((s) => s.id === studentId);
      if (student) return { app, student };
    }
    return null;
  });
}

// ---- status workflow ----

function rollupStatus(app: Application): ApplicationStatus {
  const priority: ApplicationStatus[] = [
    "enrolled",
    "enrollment_in_progress",
    "accepted",
    "interview_required",
    "under_review",
    "incomplete",
    "submitted",
    "waitlisted",
    "declined",
    "withdrawn",
    "draft",
  ];
  for (const p of priority) {
    if (app.students.some((s) => s.status === p)) return p;
  }
  return app.status;
}

/** Core transition: validates, applies, logs history. Family-level unless studentId given. */
function applyTransition(
  app: Application,
  to: ApplicationStatus,
  by: string,
  opts: { studentId?: string; note?: string } = {},
): void {
  const from = opts.studentId
    ? app.students.find((s) => s.id === opts.studentId)?.status
    : app.status;
  if (!from) throw new Error("Student not found");
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new Error(`Illegal status change: ${from} → ${to}`);
  }
  if (to === "accepted" && interviewBlocksAcceptance(app)) {
    throw new Error(
      "An interview is required before acceptance. Record the interview outcome or waive the requirement.",
    );
  }
  if (opts.studentId) {
    const student = app.students.find((s) => s.id === opts.studentId)!;
    student.status = to;
    app.status = rollupStatus(app);
  } else {
    // Family-level change: move students that shared the family status too.
    for (const s of app.students) {
      if (s.status === app.status && canTransition(s.status, to)) s.status = to;
    }
    app.status = to;
  }
  app.history.push({ from, to, by, at: now(), note: opts.note, studentId: opts.studentId });
}

export async function changeStatus(
  id: string,
  to: ApplicationStatus,
  opts: { studentId?: string; note?: string } = {},
): Promise<Application> {
  return mutate((db) => {
    const app = findApp(db, id);
    applyTransition(app, to, actorName(), opts);
    afterStatusChange(db, app);
    return clone(app);
  });
}

/** SIS + billing side effects. PDF §2.5: accepted → records; declined/waitlisted → never. */
function afterStatusChange(db: Db, app: Application): void {
  if (!SIS_CREATING_STATUSES.includes(app.status)) return;
  ensureSisRecords(db, app);
  ensureAccount(db, app);
}

function ensureSisRecords(db: Db, app: Application): void {
  app.guardians.forEach((g, gi) => {
    const id = `sis_${app.id}_g${gi}`;
    if (!db.sisRecords.some((r) => r.id === id)) {
      const dup = db.sisRecords.find(
        (r) => r.kind === "guardian" && r.fields.email === g.email && r.familyId !== app.id,
      );
      db.sisRecords.push({
        id,
        kind: "guardian",
        familyId: app.id,
        sourceApplicationId: app.id,
        fields: {
          name: `${g.firstName} ${g.lastName}`,
          email: g.email,
          phone: g.phone,
          relationship: g.relationship,
        },
        duplicateOfId: dup?.id,
      });
    }
  });
  for (const s of app.students) {
    if (["declined", "waitlisted", "withdrawn", "draft"].includes(s.status)) continue;
    const id = `sis_${app.id}_${s.id}`;
    if (!db.sisRecords.some((r) => r.id === id)) {
      const name = `${s.legalFirstName} ${s.legalLastName}`;
      const dup = db.sisRecords.find(
        (r) =>
          r.kind === "student" &&
          r.fields.name === name &&
          r.fields.dob === s.dateOfBirth &&
          r.id !== id,
      );
      db.sisRecords.push({
        id,
        kind: "student",
        familyId: app.id,
        sourceApplicationId: app.id,
        fields: {
          name,
          grade: s.gradeLevel,
          program: s.program,
          dob: s.dateOfBirth,
        },
        duplicateOfId: dup?.id,
      });
    }
  }
}

function gradeInBand(grade: string, band: string): boolean {
  const num = (g: string) => (g === "K" ? 0 : parseInt(g, 10));
  const [lo, hi] = band.split("-");
  return num(grade) >= num(lo) && num(grade) <= num(hi);
}

function tuitionFor(cfg: SchoolConfig, s: StudentApplication): number {
  const row = cfg.tuition.find(
    (t) => t.programId === s.program && gradeInBand(s.gradeLevel, t.gradeBand),
  );
  return row?.annualCents ?? 0;
}

function ensureAccount(db: Db, app: Application): FamilyAccount {
  let acct = db.accounts.find((a) => a.applicationId === app.id);
  if (acct) return acct;
  const cfg = getSchoolConfig(app.schoolSlug)!;
  const familyName = app.guardians[0] ? `${app.guardians[0].lastName} Family` : app.id;
  acct = {
    id: `acct_${uid().slice(0, 8)}`,
    applicationId: app.id,
    schoolSlug: app.schoolSlug,
    familyName,
    ledger: [],
  };
  for (const s of app.students) {
    if (["declined", "waitlisted", "withdrawn"].includes(s.status)) continue;
    const tuition = tuitionFor(cfg, s);
    if (tuition > 0) {
      acct.ledger.push({
        id: uid(),
        at: now(),
        by: "System",
        kind: "charge",
        chargeType: "tuition",
        studentId: s.id,
        amountCents: tuition,
        memo: `Tuition — ${s.legalFirstName} (Grade ${s.gradeLevel})`,
      });
    }
    for (const fee of cfg.standardFees) {
      acct.ledger.push({
        id: uid(),
        at: now(),
        by: "System",
        kind: "charge",
        chargeType: fee.chargeType as LedgerEntry["chargeType"],
        studentId: s.id,
        amountCents: fee.amountCents,
        memo: `${fee.label} — ${s.legalFirstName}`,
      });
    }
  }
  db.accounts.push(acct);
  return acct;
}

// ---- admin actions on an application ----

export async function addInternalNote(id: string, body: string): Promise<void> {
  mutate((db) => {
    findApp(db, id).internalNotes.push({
      id: uid(),
      author: actorName(),
      body,
      createdAt: now(),
    });
  });
}

export async function requestInformation(id: string, items: string): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    app.infoRequests.push({
      id: uid(),
      items,
      requestedBy: actorName(),
      requestedAt: now(),
    });
    if (canTransition(app.status, "incomplete")) {
      applyTransition(app, "incomplete", actorName(), {
        note: "Information requested",
      });
    }
    notifyFamily(db, app, "Information requested", items, "/parent");
  });
}

export async function setInterviewRequired(id: string, required: boolean): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    app.interview = app.interview ?? { required, notes: [] };
    app.interview.required = required;
    if (required && canTransition(app.status, "interview_required")) {
      applyTransition(app, "interview_required", actorName());
    }
  });
}

export async function addInterviewNote(id: string, body: string): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    if (!app.interview) app.interview = { required: true, notes: [] };
    app.interview.notes.push({
      id: uid(),
      author: actorName(),
      body,
      createdAt: now(),
    });
  });
}

export async function recordInterviewOutcome(
  id: string,
  outcome: NonNullable<Interview["outcome"]>,
): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    if (!app.interview) app.interview = { required: true, notes: [] };
    app.interview.outcome = outcome;
    app.interview.completedAt = now();
    if (outcome === "request_info" && canTransition(app.status, "incomplete")) {
      applyTransition(app, "incomplete", actorName(), { note: "After interview" });
    }
  });
}

export async function waiveInterview(id: string): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    if (!app.interview) return;
    app.interview.waivedBy = actorName();
  });
}

export async function recordDecision(
  id: string,
  studentIds: string[],
  kind: "acceptance" | "declination" | "waitlist",
): Promise<Application> {
  return mutate((db) => {
    const app = findApp(db, id);
    const cfg = getSchoolConfig(app.schoolSlug)!;
    const to: ApplicationStatus =
      kind === "acceptance" ? "accepted" : kind === "declination" ? "declined" : "waitlisted";
    const targets = studentIds.length ? studentIds : app.students.map((s) => s.id);
    for (const sid of targets) {
      applyTransition(app, to, actorName(), { studentId: sid });
    }
    const body = renderTemplate(cfg.decisionTemplates[kind], app, targets);
    app.decisionNotices.push({
      studentIds: targets,
      kind,
      body,
      sentAt: now(),
    });
    afterStatusChange(db, app);
    notifyFamily(
      db,
      app,
      `Admissions decision — ${cfg.name}`,
      "A decision notice is available in the portal.",
      "/parent",
    );
    return clone(app);
  });
}

// ---- documents & signatures ----

export async function uploadDocument(
  id: string,
  meta: { name: string; sizeBytes: number; studentId?: string },
): Promise<void> {
  // ponytail: metadata only — no real file storage.
  mutate((db) => {
    findApp(db, id).documents.push({
      id: uid(),
      name: meta.name,
      sizeBytes: meta.sizeBytes,
      uploadedAt: now(),
      studentId: meta.studentId,
    });
  });
}

export async function signWaiver(
  id: string,
  ackId: string,
  signature?: Omit<Signature, "signedAt">,
): Promise<void> {
  mutate((db) => {
    const app = findApp(db, id);
    const ack = app.acknowledgments.find((a) => a.id === ackId);
    if (!ack) throw new Error("Agreement not found");
    ack.checked = true;
    if (signature) {
      app.signatures.push({ ...signature, signedAt: now() });
    }
  });
}

// ---- SIS ----

export async function listSisRecords(): Promise<SisRecord[]> {
  const scoped = isSchoolScoped();
  return query((db) =>
    db.sisRecords.filter((r) => {
      if (!scoped) return true;
      const app = db.applications.find((a) => a.id === r.sourceApplicationId);
      return app?.schoolSlug === scoped;
    }),
  );
}

export async function resolveDuplicate(recordId: string, action: "merge" | "keep"): Promise<void> {
  mutate((db) => {
    if (action === "merge") {
      db.sisRecords = db.sisRecords.filter((r) => r.id !== recordId);
    } else {
      const rec = db.sisRecords.find((r) => r.id === recordId);
      if (rec) rec.duplicateOfId = undefined;
    }
  });
}

// ---- billing ----

export async function listAccounts(): Promise<FamilyAccount[]> {
  const scoped = isSchoolScoped();
  return query((db) => (scoped ? db.accounts.filter((a) => a.schoolSlug === scoped) : db.accounts));
}

export async function getFamilyAccount(applicationId: string): Promise<FamilyAccount | null> {
  return query((db) => db.accounts.find((a) => a.applicationId === applicationId) ?? null);
}

export async function listAccountsForParent(email: string): Promise<FamilyAccount[]> {
  const e = email.trim().toLowerCase();
  return query((db) => {
    const appIds = db.applications.filter((a) => a.parentEmail === e).map((a) => a.id);
    return db.accounts.filter((a) => appIds.includes(a.applicationId));
  });
}

export async function listInvoices(accountId: string): Promise<Invoice[]> {
  return query((db) => db.invoices.filter((i) => i.accountId === accountId));
}

export function accountBalance(acct: FamilyAccount): number {
  return acct.ledger.reduce((sum, e) => sum + e.amountCents, 0);
}

const PLAN_SCHEDULE: Record<PaymentPlanKind, string[]> = {
  full: ["2026-08-01"],
  two_payments: ["2026-08-01", "2027-01-05"],
  quarterly: ["2026-08-01", "2026-11-01", "2027-02-01", "2027-05-01"],
  monthly: [
    "2026-08-01",
    "2026-09-01",
    "2026-10-01",
    "2026-11-01",
    "2026-12-01",
    "2027-01-01",
    "2027-02-01",
    "2027-03-01",
    "2027-04-01",
    "2027-05-01",
  ],
};

export function planInstallmentsFor(
  balanceCents: number,
  kind: PaymentPlanKind,
): PlanInstallment[] {
  const dates = PLAN_SCHEDULE[kind];
  const per = Math.floor(balanceCents / dates.length);
  const remainder = balanceCents - per * dates.length;
  return dates.map((dueDate, i) => ({
    dueDate,
    amountCents: i === 0 ? per + remainder : per,
  }));
}

export async function selectPaymentPlan(
  accountId: string,
  kind: PaymentPlanKind,
): Promise<FamilyAccount> {
  return mutate((db) => {
    const acct = db.accounts.find((a) => a.id === accountId);
    if (!acct) throw new Error("Account not found");
    if (acct.plan) throw new Error("A payment plan is already active");
    const balance = accountBalance(acct);
    const installments = planInstallmentsFor(balance, kind);
    acct.plan = {
      kind,
      acknowledgedPoliciesAt: now(),
      installments,
    };
    installments.forEach((inst, i) => {
      const inv: Invoice = {
        id: `inv_${uid().slice(0, 8)}`,
        accountId: acct.id,
        dueDate: inst.dueDate,
        amountCents: inst.amountCents,
        status: "due",
      };
      db.invoices.push(inv);
      acct.plan!.installments[i].invoiceId = inv.id;
    });
    // Choosing a plan moves an accepted family into enrollment. PDF §7.1 / M5.
    const app = findApp(db, acct.applicationId);
    if (app.status === "accepted") {
      applyTransition(app, "enrollment_in_progress", actorName(), {
        note: `Payment plan selected (${kind})`,
      });
    }
    return clone(acct);
  });
}

export async function makePayment(
  accountId: string,
  invoiceId: string,
  fundingSource: LedgerEntry["fundingSource"] = "parent",
): Promise<void> {
  // ponytail: mock processor — payment always succeeds.
  mutate((db) => {
    const acct = db.accounts.find((a) => a.id === accountId);
    const inv = db.invoices.find((i) => i.id === invoiceId);
    if (!acct || !inv) throw new Error("Invoice not found");
    if (inv.status === "paid") throw new Error("Invoice already paid");
    inv.status = "paid";
    inv.paidAt = now();
    acct.ledger.push({
      id: uid(),
      at: now(),
      by: actor?.role === "parent" ? "parent" : actorName(),
      kind: "payment",
      fundingSource,
      amountCents: -inv.amountCents,
      memo: `Invoice ${inv.id} (due ${inv.dueDate})`,
    });
  });
}

export async function addLedgerEntry(
  accountId: string,
  entry: Omit<LedgerEntry, "id" | "at" | "by">,
): Promise<void> {
  // All financial adjustments log admin name, date, amount. PDF §7.
  mutate((db) => {
    const acct = db.accounts.find((a) => a.id === accountId);
    if (!acct) throw new Error("Account not found");
    acct.ledger.push({ ...entry, id: uid(), at: now(), by: actorName() });
  });
}

export async function setHold(accountId: string, on: boolean, reason = ""): Promise<void> {
  mutate((db) => {
    const acct = db.accounts.find((a) => a.id === accountId);
    if (!acct) throw new Error("Account not found");
    acct.hold = on ? { placedBy: actorName(), placedAt: now(), reason } : undefined;
    if (on) {
      const app = findApp(db, acct.applicationId);
      notifyFamily(
        db,
        app,
        "Financial hold placed",
        reason || "Contact the school office.",
        "/parent/billing",
      );
    }
  });
}

// ---- placement & courses ----

function mockRecommendation(
  s: StudentApplication,
  subject: Subject,
): { course: string; start: string } {
  // ponytail: fake IBL AI adaptive result — deterministic from grade.
  const label = subject === "math" ? "Math" : "Language Arts";
  const g = s.gradeLevel === "K" ? 0 : parseInt(s.gradeLevel, 10);
  const unit = subject === "math" ? "Unit" : "Module";
  return { course: `${label} ${s.gradeLevel}`, start: `${unit} ${(g % 3) + 1}` };
}

export async function assignPlacement(studentIds: string[], subjects: Subject[]): Promise<void> {
  mutate((db) => {
    for (const app of db.applications) {
      for (const s of app.students) {
        if (!studentIds.includes(s.id)) continue;
        for (const subject of subjects) {
          if (s.placement[subject].status === "not_assigned") {
            s.placement[subject] = { status: "assigned", updatedAt: now() };
          }
        }
        notifyStudent(
          db,
          s,
          "Placement test assigned",
          "Start your placement test from your dashboard.",
        );
      }
    }
  });
}

/** Student simulation: assigned → started → completed (with a mock recommendation). */
export async function advancePlacement(studentId: string, subject: Subject): Promise<void> {
  mutate((db) => {
    for (const app of db.applications) {
      const s = app.students.find((x) => x.id === studentId);
      if (!s) continue;
      const p = s.placement[subject];
      if (p.status === "assigned") {
        s.placement[subject] = { status: "started", updatedAt: now() };
      } else if (p.status === "started") {
        const rec = mockRecommendation(s, subject);
        s.placement[subject] = {
          status: "completed",
          recommendedCourse: rec.course,
          recommendedStartPoint: rec.start,
          updatedAt: now(),
        };
      }
      return;
    }
    throw new Error("Student not found");
  });
}

export async function reviewPlacement(studentId: string, subject: Subject): Promise<void> {
  mutate((db) => {
    for (const app of db.applications) {
      const s = app.students.find((x) => x.id === studentId);
      if (!s) continue;
      if (s.placement[subject].status === "completed") {
        s.placement[subject].status = "reviewed";
        s.placement[subject].updatedAt = now();
      }
      return;
    }
  });
}

export async function confirmPlacement(
  studentId: string,
  subject: Subject,
  final: { course: string; start: string },
): Promise<void> {
  mutate((db) => {
    for (const app of db.applications) {
      const s = app.students.find((x) => x.id === studentId);
      if (!s) continue;
      s.placement[subject] = {
        ...s.placement[subject],
        status: "confirmed",
        finalCourse: final.course,
        finalStartPoint: final.start,
        updatedAt: now(),
      };
      // Record final placement in the SIS record. PDF §9.1.
      const sis = db.sisRecords.find((r) => r.id === `sis_${app.id}_${s.id}`);
      if (sis) {
        sis.fields[`placement_${subject}`] = `${final.course} @ ${final.start}`;
      }
      return;
    }
    throw new Error("Student not found");
  });
}

export async function assignCourses(
  studentId: string,
  courses: { courseId: string; courseName: string; startDate: string }[],
): Promise<void> {
  mutate((db) => {
    for (const app of db.applications) {
      const s = app.students.find((x) => x.id === studentId);
      if (!s) continue;
      const today = now().slice(0, 10);
      for (const c of courses) {
        if (s.courseEnrollments.some((e) => e.courseId === c.courseId)) continue;
        s.courseEnrollments.push({ ...c, active: c.startDate <= today });
      }
      notifyStudent(db, s, "Courses assigned", "New courses are available on your dashboard.");
      return;
    }
    throw new Error("Student not found");
  });
}

export async function removeCourse(studentId: string, courseId: string): Promise<void> {
  mutate((db) => {
    for (const app of db.applications) {
      const s = app.students.find((x) => x.id === studentId);
      if (!s) continue;
      s.courseEnrollments = s.courseEnrollments.filter((e) => e.courseId !== courseId);
      return;
    }
  });
}

// ---- notifications ----

function notifyFamily(db: Db, app: Application, title: string, body: string, href?: string): void {
  db.notifications.push({
    id: uid(),
    userId: app.parentEmail,
    title,
    body,
    href,
    createdAt: now(),
  });
}

function notifyStudent(db: Db, s: StudentApplication, title: string, body: string): void {
  db.notifications.push({
    id: uid(),
    userId: s.id,
    title,
    body,
    href: "/student",
    createdAt: now(),
  });
}

/** Matches seed ids ('parent_brown'), runtime keys (parent email), and student ids. */
export async function listNotifications(keys: string[]): Promise<AppNotification[]> {
  return query((db) =>
    db.notifications
      .filter((n) => keys.includes(n.userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  mutate((db) => {
    const n = db.notifications.find((x) => x.id === id);
    if (n && !n.readAt) n.readAt = now();
  });
}

// ---- communications (PDF §12) ----

export async function sendCommunication(
  applicationId: string,
  templateId: CommunicationTemplateId,
): Promise<void> {
  mutate((db) => {
    const app = findApp(db, applicationId);
    const tpl = COMMUNICATION_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) throw new Error("Unknown template");
    // ponytail: logged to the record, not actually emailed.
    app.communications.push({
      id: uid(),
      templateId,
      subject: tpl.subject,
      body: renderTemplate(tpl.body, app),
      sentBy: actorName(),
      sentAt: now(),
    });
    notifyFamily(db, app, tpl.subject, "You have a new message from the school.", "/parent");
  });
}

// ---- re-enrollment (PDF §11) ----

export async function startReenrollment(
  familyApplicationId: string,
): Promise<FamilyApplicationView> {
  const source = await getApplicationForFamily(familyApplicationId);
  const cfg = await getSchool(source.schoolSlug);
  return mutate((db) => {
    db.seq[cfg.slug] = (db.seq[cfg.slug] ?? 0) + 1;
    const id = `${cfg.shortName.toUpperCase()}-2026-${String(db.seq[cfg.slug]).padStart(4, "0")}`;
    const bumpGrade = (g: string) =>
      g === "K" ? "1" : g === "12" ? "12" : String(parseInt(g, 10) + 1);
    const app: Application = {
      ...clone(source as unknown as Application),
      id,
      status: "draft",
      // Pre-populated from existing records; renewed waivers required. PDF §11.
      acknowledgments: cfg.agreements.map((a) => ({
        id: a.id,
        label: a.label,
        documentUrl: a.documentUrl,
        checked: false,
        handbookVersion: a.id.includes("handbook") ? cfg.handbook.version : undefined,
      })),
      signatures: [],
      documents: [],
      students: (source.students as StudentApplication[]).map((s) => ({
        ...clone(s),
        id: `stu_${uid().slice(0, 8)}`,
        status: "draft" as const,
        gradeLevel: bumpGrade(s.gradeLevel),
        placement: {
          math: { status: "not_assigned" as const },
          languageArts: { status: "not_assigned" as const },
        },
        courseEnrollments: [],
      })),
      fee: {
        amountCents: feeAmount(cfg, source.students.length),
        basis: cfg.fee.basis,
        status: "unpaid",
        refundability: cfg.fee.refundability,
      },
      interview: cfg.interviewRequiredByDefault ? { required: true, notes: [] } : undefined,
      internalNotes: [],
      history: [],
      decisionNotices: [],
      infoRequests: [],
      communications: [],
      submittedAt: undefined,
      createdAt: now(),
      isReenrollment: true,
    };
    db.applications.push(app);
    return toFamilyView(app);
  });
}

// ---- misc ----

export async function resetDemoData(): Promise<void> {
  resetDb();
}
