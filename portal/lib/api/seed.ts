import type {
  Acknowledgment,
  Application,
  ApplicationFee,
  ApplicationStatus,
  Db,
  FamilyAccount,
  Guardian,
  Invoice,
  PlacementRecord,
  SisRecord,
  StudentApplication,
  Subject,
} from "../types";
import { afa } from "../schools/afa";
import { graceNetwork } from "../schools/grace-network";
import type { SchoolConfig } from "../schools/types";

// Deterministic seed — no Date.now()/random so a reset always yields the same demo.
const T = (d: string) => `2026-${d}T14:00:00.000Z`;

function addr(street: string, city: string, state: string, zip: string) {
  return { street, city, state, zip };
}

function guardian(
  firstName: string,
  lastName: string,
  relationship: string,
  email: string,
  phone: string,
  a = addr("100 Main St", "Springfield", "MO", "65801"),
): Guardian {
  return { firstName, lastName, relationship, email, phone, address: a };
}

function acks(cfg: SchoolConfig, checked: boolean): Acknowledgment[] {
  return cfg.agreements.map((ag) => ({
    id: ag.id,
    label: ag.label,
    documentUrl: ag.documentUrl,
    checked,
    handbookVersion: ag.id.includes("handbook") ? cfg.handbook.version : undefined,
  }));
}

function feeFor(
  cfg: SchoolConfig,
  numStudents: number,
  status: ApplicationFee["status"],
): ApplicationFee {
  const amount =
    cfg.fee.basis === "student" ? cfg.fee.amountCents * numStudents : cfg.fee.amountCents;
  return {
    amountCents: amount,
    basis: cfg.fee.basis,
    status,
    refundability: cfg.fee.refundability,
    paidAt: status === "paid" ? T("06-02") : undefined,
    method: status === "paid" ? "card" : undefined,
  };
}

function placement(
  status: PlacementRecord["status"],
  recommendedCourse?: string,
  recommendedStartPoint?: string,
  final?: { course: string; start: string },
): PlacementRecord {
  return {
    status,
    recommendedCourse,
    recommendedStartPoint,
    finalCourse: final?.course,
    finalStartPoint: final?.start,
    updatedAt: status === "not_assigned" ? undefined : T("06-20"),
  };
}

let sc = 0;
function student(
  first: string,
  last: string,
  grade: string,
  program: string,
  status: ApplicationStatus,
  opts: Partial<StudentApplication> = {},
): StudentApplication {
  sc += 1;
  const noPlacement: Record<Subject, PlacementRecord> = {
    math: placement("not_assigned"),
    languageArts: placement("not_assigned"),
  };
  return {
    id: `stu_${sc}`,
    status,
    legalFirstName: first,
    legalLastName: last,
    gradeLevel: grade,
    program,
    gender: "Not specified",
    dateOfBirth: gradeToDob(grade),
    email:
      grade !== "K" && grade !== "1" && grade !== "2"
        ? `${first.toLowerCase()}.${last.toLowerCase()}@student.example.edu`
        : undefined,
    supportInfo: "No known learning differences.",
    academicBackground: {
      recent_experience: "Homeschooled for the past two years.",
      academic_strengths: "Reading comprehension and curiosity.",
    },
    placement: opts.placement ?? noPlacement,
    courseEnrollments: opts.courseEnrollments ?? [],
    ...opts,
  };
}

function gradeToDob(grade: string): string {
  const g = grade === "K" ? 0 : parseInt(grade, 10);
  const birthYear = 2026 - (g + 5);
  return `${birthYear}-09-15`;
}

let appSeq: Record<string, number> = {};
function appId(cfg: SchoolConfig): string {
  appSeq[cfg.slug] = (appSeq[cfg.slug] ?? 0) + 1;
  return `${cfg.shortName.toUpperCase()}-2026-${String(appSeq[cfg.slug]).padStart(4, "0")}`;
}

interface AppSpec {
  cfg: SchoolConfig;
  status: ApplicationStatus;
  guardians: Guardian[];
  students: StudentApplication[];
  feeStatus: ApplicationFee["status"];
  submittedAt?: string;
  interview?: Application["interview"];
  internalNotes?: Application["internalNotes"];
  history?: Application["history"];
  decisionNotices?: Application["decisionNotices"];
  infoRequests?: Application["infoRequests"];
}

function makeApp(spec: AppSpec): Application {
  const id = appId(spec.cfg);
  const ackChecked = spec.status !== "draft";
  return {
    id,
    schoolSlug: spec.cfg.slug,
    programYear: spec.cfg.programYear,
    status: spec.status,
    parentEmail: spec.guardians[0].email,
    guardians: spec.guardians,
    familyAnswers: {
      why_afa: "We want a Christ-centered classical education for our children.",
      why_school: "We want a Christ-centered classical education for our children.",
      church_involvement: "Active members of our local church.",
    },
    students: spec.students,
    acknowledgments: acks(spec.cfg, ackChecked),
    signatures: ackChecked
      ? [
          {
            role: "primary_parent",
            signerName: `${spec.guardians[0].firstName} ${spec.guardians[0].lastName}`,
            signature: `${spec.guardians[0].firstName} ${spec.guardians[0].lastName}`,
            signedAt: T("06-01"),
          },
        ]
      : [],
    medicalRelease: spec.cfg.requiresMedicalRelease
      ? {
          emergencyContactName: "Pat Kelley",
          emergencyContactPhone: "417-555-0142",
          emergencyContactRelationship: "Aunt",
          physician: "Dr. Alvarez",
          insuranceProvider: "BlueCross",
          policyNumber: "BC-99123",
          treatmentAuthorized: true,
          effectiveFrom: "2026-08-01",
          effectiveTo: "2027-06-30",
        }
      : undefined,
    documents: ackChecked
      ? [
          {
            id: `doc_${id}`,
            name: "birth-certificate.pdf",
            sizeBytes: 184320,
            uploadedAt: T("06-01"),
          },
        ]
      : [],
    fee: feeFor(spec.cfg, spec.students.length, spec.feeStatus),
    interview: spec.interview,
    internalNotes: spec.internalNotes ?? [],
    history: spec.history ?? [
      {
        from: "draft",
        to: spec.status,
        by: "System",
        at: T("06-01"),
      },
    ],
    decisionNotices: spec.decisionNotices ?? [],
    infoRequests: spec.infoRequests ?? [],
    communications: [],
    submittedAt: spec.submittedAt ?? (ackChecked ? T("06-01") : undefined),
    createdAt: T("05-28"),
  };
}

export function buildSeed(): Db {
  appSeq = {};
  sc = 0;

  const applications: Application[] = [
    // 1. AFA draft — fee unpaid, not submitted
    makeApp({
      cfg: afa,
      status: "draft",
      feeStatus: "unpaid",
      guardians: [
        guardian("Rachel", "Johnson", "Mother", "rachel.johnson@example.com", "417-555-0101"),
      ],
      students: [student("Ella", "Johnson", "4", "full_academic", "draft")],
    }),
    // 2. AFA submitted — 2 students, fee paid
    makeApp({
      cfg: afa,
      status: "submitted",
      feeStatus: "paid",
      guardians: [
        guardian("David", "Smith", "Father", "david.smith@example.com", "417-555-0102"),
        guardian("Sarah", "Smith", "Mother", "sarah.smith@example.com", "417-555-0112"),
      ],
      students: [
        student("Noah", "Smith", "7", "full_academic", "submitted"),
        student("Grace", "Smith", "2", "soar_essentials", "submitted"),
      ],
    }),
    // 3. AFA under review — 1 student, internal note
    makeApp({
      cfg: afa,
      status: "under_review",
      feeStatus: "paid",
      guardians: [
        guardian("Michael", "Williams", "Father", "michael.williams@example.com", "417-555-0103"),
      ],
      students: [student("Liam", "Williams", "9", "full_academic", "under_review")],
      internalNotes: [
        {
          id: "n1",
          author: "A. Reyes",
          body: "Strong application; verify prior transcript.",
          createdAt: T("06-05"),
        },
      ],
      history: [
        { from: "draft", to: "submitted", by: "Michael Williams", at: T("06-01") },
        { from: "submitted", to: "under_review", by: "A. Reyes", at: T("06-04") },
      ],
    }),
    // 4. AFA enrolled — account + monthly plan + SIS + placement confirmed + courses
    makeApp({
      cfg: afa,
      status: "enrolled",
      feeStatus: "paid",
      guardians: [guardian("James", "Brown", "Father", "james.brown@example.com", "417-555-0104")],
      students: [
        student("Olivia", "Brown", "6", "full_academic", "enrolled", {
          placement: {
            math: placement("confirmed", "Math 6", "Unit 2", { course: "Math 6", start: "Unit 3" }),
            languageArts: placement("confirmed", "Language Arts 6", "Module 1", {
              course: "Language Arts 6",
              start: "Module 1",
            }),
          },
          courseEnrollments: [
            { courseId: "math6", courseName: "Math 6", startDate: "2026-08-20", active: true },
            {
              courseId: "la6",
              courseName: "Language Arts 6",
              startDate: "2026-08-20",
              active: true,
            },
          ],
        }),
        student("Lucas", "Brown", "3", "full_academic", "enrolled", {
          placement: {
            math: placement("confirmed", "Math 3", "Unit 1", { course: "Math 3", start: "Unit 1" }),
            languageArts: placement("reviewed", "Language Arts 3", "Module 2"),
          },
          courseEnrollments: [
            { courseId: "math3", courseName: "Math 3", startDate: "2026-09-15", active: false },
          ],
        }),
      ],
      history: [
        { from: "draft", to: "submitted", by: "James Brown", at: T("05-20") },
        { from: "submitted", to: "under_review", by: "A. Reyes", at: T("05-22") },
        { from: "under_review", to: "accepted", by: "A. Reyes", at: T("05-25") },
        { from: "accepted", to: "enrollment_in_progress", by: "James Brown", at: T("06-01") },
        { from: "enrollment_in_progress", to: "enrolled", by: "A. Reyes", at: T("06-10") },
      ],
      decisionNotices: [
        {
          studentIds: ["stu_"],
          kind: "acceptance",
          body: "Welcome to American Faith Academy!",
          sentAt: T("05-25"),
        },
      ],
    }),
    // 5. AFA declined
    makeApp({
      cfg: afa,
      status: "declined",
      feeStatus: "paid",
      guardians: [
        guardian("Robert", "Davis", "Father", "robert.davis@example.com", "417-555-0105"),
      ],
      students: [student("Mia", "Davis", "11", "full_academic", "declined")],
      history: [
        { from: "draft", to: "submitted", by: "Robert Davis", at: T("05-30") },
        { from: "submitted", to: "under_review", by: "A. Reyes", at: T("06-02") },
        { from: "under_review", to: "declined", by: "A. Reyes", at: T("06-06") },
      ],
      decisionNotices: [
        {
          studentIds: ["stu_"],
          kind: "declination",
          body: "Thank you for your interest.",
          sentAt: T("06-06"),
        },
      ],
    }),
    // 6. Grace interview required — 2 students
    makeApp({
      cfg: graceNetwork,
      status: "interview_required",
      feeStatus: "paid",
      guardians: [
        guardian(
          "Carlos",
          "Miller",
          "Father",
          "carlos.miller@example.com",
          "314-555-0106",
          addr("42 Oak Ave", "St. Louis", "MO", "63101"),
        ),
        guardian(
          "Ana",
          "Miller",
          "Mother",
          "ana.miller@example.com",
          "314-555-0116",
          addr("42 Oak Ave", "St. Louis", "MO", "63101"),
        ),
      ],
      students: [
        student("Sofia", "Miller", "8", "academic", "interview_required"),
        student("Diego", "Miller", "5", "academic", "interview_required"),
      ],
      interview: {
        required: true,
        notes: [
          {
            id: "iv1",
            author: "M. Osei",
            body: "Scheduled for June 18. Family is engaged.",
            createdAt: T("06-12"),
          },
        ],
      },
      history: [
        { from: "draft", to: "submitted", by: "Carlos Miller", at: T("06-08") },
        { from: "submitted", to: "under_review", by: "M. Osei", at: T("06-10") },
        { from: "under_review", to: "interview_required", by: "M. Osei", at: T("06-11") },
      ],
    }),
    // 7. Grace enrollment in progress — accepted, plan chosen, placement assigned
    makeApp({
      cfg: graceNetwork,
      status: "enrollment_in_progress",
      feeStatus: "paid",
      guardians: [
        guardian(
          "Maria",
          "Garcia",
          "Mother",
          "maria.garcia@example.com",
          "314-555-0107",
          addr("9 Elm St", "St. Louis", "MO", "63102"),
        ),
      ],
      students: [
        student("Isabella", "Garcia", "10", "academic", "enrollment_in_progress", {
          placement: {
            math: placement("assigned"),
            languageArts: placement("started"),
          },
        }),
      ],
      interview: {
        required: true,
        notes: [
          {
            id: "iv2",
            author: "M. Osei",
            body: "Interview complete — excellent fit.",
            createdAt: T("06-14"),
          },
        ],
        outcome: "proceed",
        completedAt: T("06-14"),
      },
      history: [
        { from: "draft", to: "submitted", by: "Maria Garcia", at: T("06-01") },
        { from: "submitted", to: "interview_required", by: "M. Osei", at: T("06-05") },
        { from: "interview_required", to: "accepted", by: "M. Osei", at: T("06-14") },
        { from: "accepted", to: "enrollment_in_progress", by: "Maria Garcia", at: T("06-16") },
      ],
      decisionNotices: [
        {
          studentIds: ["stu_"],
          kind: "acceptance",
          body: "Welcome to Grace Network School!",
          sentAt: T("06-14"),
        },
      ],
    }),
    // 8. Grace waitlisted
    makeApp({
      cfg: graceNetwork,
      status: "waitlisted",
      feeStatus: "paid",
      guardians: [
        guardian(
          "Kevin",
          "Martinez",
          "Father",
          "kevin.martinez@example.com",
          "314-555-0108",
          addr("7 Pine Rd", "St. Louis", "MO", "63103"),
        ),
      ],
      students: [student("Emma", "Martinez", "1", "enrichment", "waitlisted")],
      interview: {
        required: true,
        notes: [
          {
            id: "iv3",
            author: "M. Osei",
            body: "Good family; capacity constrained in grade 1.",
            createdAt: T("06-13"),
          },
        ],
        outcome: "waitlist",
        completedAt: T("06-13"),
      },
      history: [
        { from: "draft", to: "submitted", by: "Kevin Martinez", at: T("06-02") },
        { from: "submitted", to: "interview_required", by: "M. Osei", at: T("06-06") },
        { from: "interview_required", to: "waitlisted", by: "M. Osei", at: T("06-13") },
      ],
      decisionNotices: [
        {
          studentIds: ["stu_"],
          kind: "waitlist",
          body: "You have been placed on our waitlist.",
          sentAt: T("06-13"),
        },
      ],
    }),
    // 9. Grace incomplete — info requested
    makeApp({
      cfg: graceNetwork,
      status: "incomplete",
      feeStatus: "unpaid",
      guardians: [
        guardian(
          "Jenny",
          "Lee",
          "Mother",
          "jenny.lee@example.com",
          "314-555-0109",
          addr("3 Birch Ln", "St. Louis", "MO", "63104"),
        ),
      ],
      students: [student("Ethan", "Lee", "6", "academic", "incomplete")],
      infoRequests: [
        {
          id: "ir1",
          items: "Please upload a recent report card and complete the medical release.",
          requestedBy: "M. Osei",
          requestedAt: T("06-09"),
        },
      ],
      history: [
        { from: "draft", to: "submitted", by: "Jenny Lee", at: T("06-07") },
        { from: "submitted", to: "incomplete", by: "M. Osei", at: T("06-09") },
      ],
    }),
  ];

  // ---- Family accounts / invoices for accepted+ families ----
  const accounts: FamilyAccount[] = [];
  const invoices: Invoice[] = [];
  const sisRecords: SisRecord[] = [];

  const brown = applications.find((a) => a.id === "AFA-2026-0004")!;
  const garcia = applications.find((a) => a.id === "GRACE-2026-0002")!;

  // Brown — enrolled, monthly plan with 10 installments (2 paid)
  const brownInstallments = Array.from({ length: 10 }, (_, i) => ({
    invId: `inv_brown_${i + 1}`,
    i,
  }));
  accounts.push({
    id: "acct_brown",
    applicationId: brown.id,
    schoolSlug: "afa",
    familyName: "Brown Family",
    plan: {
      kind: "monthly",
      acknowledgedPoliciesAt: T("06-01"),
      installments: brownInstallments.map(({ invId }, i) => ({
        dueDate: `2026-${String(8 + i).padStart(2, "0")}-01`
          .replace("2026-13", "2027-01")
          .replace("2026-14", "2027-02")
          .replace("2026-15", "2027-03")
          .replace("2026-16", "2027-04")
          .replace("2026-17", "2027-05"),
        amountCents: 99000,
        invoiceId: invId,
      })),
    },
    ledger: [
      {
        id: "l1",
        at: T("06-01"),
        by: "System",
        kind: "charge",
        chargeType: "tuition",
        studentId: brown.students[0].id,
        amountCents: 495000,
        memo: "Tuition — Olivia (Grade 6)",
      },
      {
        id: "l2",
        at: T("06-01"),
        by: "System",
        kind: "charge",
        chargeType: "tuition",
        studentId: brown.students[1].id,
        amountCents: 450000,
        memo: "Tuition — Lucas (Grade 3)",
      },
      {
        id: "l3",
        at: T("06-02"),
        by: "parent",
        kind: "payment",
        fundingSource: "parent",
        amountCents: -99000,
        memo: "August installment",
      },
      {
        id: "l4",
        at: T("07-02"),
        by: "parent",
        kind: "payment",
        fundingSource: "esa",
        amountCents: -99000,
        memo: "September installment (ESA)",
      },
    ],
  });
  brownInstallments.forEach(({ invId, i }) => {
    invoices.push({
      id: invId,
      accountId: "acct_brown",
      dueDate: `2026-${String(8 + i).padStart(2, "0")}-01`
        .replace("2026-13", "2027-01")
        .replace("2026-14", "2027-02")
        .replace("2026-15", "2027-03")
        .replace("2026-16", "2027-04")
        .replace("2026-17", "2027-05"),
      amountCents: 99000,
      status: i < 2 ? "paid" : "due",
      paidAt: i < 2 ? T("06-02") : undefined,
    });
  });

  // Garcia — enrollment in progress, pay-in-full plan, one invoice due
  accounts.push({
    id: "acct_garcia",
    applicationId: garcia.id,
    schoolSlug: "grace-network",
    familyName: "Garcia Family",
    plan: {
      kind: "full",
      acknowledgedPoliciesAt: T("06-16"),
      installments: [{ dueDate: "2026-08-01", amountCents: 460000, invoiceId: "inv_garcia_1" }],
    },
    ledger: [
      {
        id: "lg1",
        at: T("06-16"),
        by: "System",
        kind: "charge",
        chargeType: "tuition",
        studentId: garcia.students[0].id,
        amountCents: 460000,
        memo: "Tuition — Isabella (Grade 10)",
      },
      {
        id: "lg2",
        at: T("06-16"),
        by: "System",
        kind: "charge",
        chargeType: "facility",
        amountCents: 30000,
        memo: "Facility fee",
      },
      {
        id: "lg3",
        at: T("06-16"),
        by: "M. Osei",
        kind: "credit",
        fundingSource: "scholarship",
        amountCents: -50000,
        memo: "Grace scholarship",
      },
    ],
    hold: {
      placedBy: "Finance",
      placedAt: T("06-20"),
      reason: "Awaiting first payment before course access.",
    },
  });
  invoices.push({
    id: "inv_garcia_1",
    accountId: "acct_garcia",
    dueDate: "2026-08-01",
    amountCents: 440000,
    status: "due",
  });

  // ---- SIS records for accepted+ families ----
  for (const app of applications) {
    if (["accepted", "enrollment_in_progress", "enrolled"].includes(app.status)) {
      app.guardians.forEach((g, gi) => {
        sisRecords.push({
          id: `sis_${app.id}_g${gi}`,
          kind: "guardian",
          familyId: app.id,
          sourceApplicationId: app.id,
          fields: {
            name: `${g.firstName} ${g.lastName}`,
            email: g.email,
            phone: g.phone,
            relationship: g.relationship,
          },
        });
      });
      app.students.forEach((s) => {
        sisRecords.push({
          id: `sis_${app.id}_${s.id}`,
          kind: "student",
          familyId: app.id,
          sourceApplicationId: app.id,
          fields: {
            name: `${s.legalFirstName} ${s.legalLastName}`,
            grade: s.gradeLevel,
            program: s.program,
            dob: s.dateOfBirth,
          },
        });
      });
    }
  }
  // A duplicate flag for demo (same-name heuristic)
  sisRecords.push({
    id: "sis_dup_demo",
    kind: "student",
    familyId: brown.id,
    sourceApplicationId: brown.id,
    fields: { name: "Olivia Brown", grade: "6", program: "full_academic", dob: "2015-09-15" },
    duplicateOfId: `sis_${brown.id}_${brown.students[0].id}`,
  });

  // ---- Notifications (for the parent + student demo users) ----
  const notifications = [
    {
      id: "nt1",
      userId: "parent_brown",
      title: "Application accepted",
      body: "Olivia and Lucas have been accepted to American Faith Academy.",
      href: "/parent",
      readAt: undefined,
      createdAt: T("05-25"),
    },
    {
      id: "nt2",
      userId: "parent_brown",
      title: "Invoice due",
      body: "Your October tuition installment is due soon.",
      href: "/parent/billing",
      readAt: undefined,
      createdAt: T("09-25"),
    },
    {
      id: "nt3",
      userId: "parent_garcia",
      title: "Financial hold placed",
      body: "A financial hold is on your account pending first payment.",
      href: "/parent/billing",
      readAt: undefined,
      createdAt: T("06-20"),
    },
    {
      id: "nt4",
      userId: "student_brown",
      title: "Course available",
      body: "Math 6 is now available on your dashboard.",
      href: "/student",
      readAt: T("08-21"),
      createdAt: T("08-20"),
    },
  ];

  return {
    version: 1,
    applications,
    accounts,
    invoices,
    sisRecords,
    notifications,
    seq: { ...appSeq },
  };
}
