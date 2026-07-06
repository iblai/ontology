import type { SchoolConfig } from "./types";

// Grace Network School — an example Ministry.com Network School (hybrid). PDF §4.
// ponytail: fictional pilot school; real network schools are cloned from this shape.
export const graceNetwork: SchoolConfig = {
  slug: "grace-network",
  name: "Grace Network School",
  shortName: "Grace",
  logo: "/grace-logo.svg",
  accentColor: "#047857",
  model: "network",
  programYear: "2026-2027",
  intro:
    "Welcome to Grace Network School enrollment. Complete one application for your family; a family interview is part of our admissions process.",
  announcements: [
    "A family interview is required before an admissions decision.",
    "Placement testing is scheduled by the school after enrollment.",
  ],

  programs: [
    { id: "academic", label: "Academic Program" },
    { id: "enrichment", label: "Enrichment Program" },
    { id: "guided_study", label: "Guided Study Program" },
  ],

  familyQuestions: [
    {
      id: "church_involvement",
      label:
        "Please briefly describe your family's involvement in your church, parish, or faith community, if applicable.",
      kind: "textarea",
    },
    {
      id: "educational_philosophy",
      label:
        "Please briefly describe how your family's faith, values, or educational philosophy shapes daily life and learning.",
      kind: "textarea",
    },
    {
      id: "why_school",
      label: "Why have you decided to apply to Grace Network School?",
      kind: "textarea",
      required: true,
    },
    {
      id: "anything_else",
      label:
        "Is there any other information that would help us better understand and serve your student(s)?",
      kind: "textarea",
    },
  ],

  academicBackgroundQuestions: [
    {
      id: "recent_experience",
      label: "Tell us about this student's recent school experience.",
      kind: "textarea",
    },
    {
      id: "current_school",
      label: "Where is the student currently attending school or learning?",
      kind: "text",
    },
    { id: "subjects", label: "What subjects are being studied?", kind: "text" },
    {
      id: "curriculum",
      label: "What curricula or programs are being used?",
      kind: "text",
    },
    {
      id: "challenge_level",
      label: "What level of difficulty or challenge is the student experiencing?",
      kind: "text",
    },
    {
      id: "hours_per_day",
      label: "How many hours per day does the student typically spend on schoolwork?",
      kind: "text",
    },
    // Parent Academic and Character Assessment
    {
      id: "academic_strengths",
      label: "What are this student's academic strengths?",
      kind: "textarea",
    },
    {
      id: "academic_weaknesses",
      label: "What are this student's academic weaknesses or areas needing growth?",
      kind: "textarea",
    },
    {
      id: "character_strengths",
      label: "What are this student's character strengths?",
      kind: "textarea",
    },
    {
      id: "character_weaknesses",
      label: "What are this student's character weaknesses or areas needing growth?",
      kind: "textarea",
    },
  ],

  studentResponseQuestions: [
    {
      id: "why_student",
      label: "Why would you like to become a student at Grace Network School?",
      kind: "textarea",
    },
    {
      id: "work_on",
      label:
        "What aspect of your academic life are you planning to work on this year, and how do you plan to achieve your academic goals?",
      kind: "textarea",
    },
    {
      id: "long_term_goals",
      label: "What are your long-term academic goals or career interests?",
      kind: "textarea",
    },
    {
      id: "interests",
      label: "What interests do you have outside of school?",
      kind: "textarea",
    },
    { id: "reads_for_recreation", label: "Do you read for recreation?", kind: "yesno" },
    {
      id: "last_book",
      label: "What was the last book you read, and why did you choose it?",
      kind: "textarea",
    },
    {
      id: "faith_daily_life",
      label:
        "If applicable, tell us about your relationship with Jesus Christ and how it affects your daily life.",
      kind: "textarea",
    },
  ],

  agreements: [
    {
      id: "statement_of_faith",
      label: "Statement of Faith, Mission, and Values acknowledgment",
      documentUrl: "https://gracenetworkschool.org/statement-of-faith",
      required: true,
    },
    {
      id: "student_honor_code",
      label: "Student Honor Code acknowledgment",
      documentUrl: "https://gracenetworkschool.org/honor-code",
      required: true,
    },
    {
      id: "equipment_materials",
      label: "Equipment and Materials acknowledgment",
      required: true,
    },
    {
      id: "medical_release",
      label: "Medical Release Authorization",
      required: true,
    },
    {
      id: "insurance_waiver",
      label: "Insurance Waiver and Liability Release",
      required: true,
    },
    {
      id: "handbook_acceptance",
      label: "Family Handbook and Policy Acceptance",
      documentUrl: "https://gracenetworkschool.org/handbook",
      required: true,
    },
  ],
  signatures: { primaryParent: true, coParent: true, student: true },
  requiresMedicalRelease: true,
  requiresPhotoMediaRelease: true,
  interviewRequiredByDefault: true,

  fee: {
    // ponytail: placeholder amounts — real fees come from each school.
    amountCents: 5000,
    basis: "student",
    refundability: "creditable",
    lateFeeCents: 2500,
    lateFeeAfter: "2026-03-01",
  },

  handbook: {
    url: "https://gracenetworkschool.org/handbook",
    version: "2026-2027",
  },
  decisionTemplates: {
    acceptance:
      "Dear {{parentName}}, following your family interview we are pleased to welcome {{studentNames}} to Grace Network School for {{programYear}}. Please complete financial enrollment to secure your place.",
    declination:
      "Dear {{parentName}}, thank you for interviewing with Grace Network School. After review we are unable to offer {{studentNames}} a place at this time.",
    waitlist:
      "Dear {{parentName}}, {{studentNames}} has been added to the Grace Network School waitlist for {{programYear}}. We will be in touch if a spot opens.",
  },
  tuition: [
    { gradeBand: "K-5", programId: "academic", annualCents: 380000 },
    { gradeBand: "6-8", programId: "academic", annualCents: 410000 },
    { gradeBand: "9-12", programId: "academic", annualCents: 460000 },
    { gradeBand: "K-12", programId: "enrichment", annualCents: 180000 },
    { gradeBand: "K-12", programId: "guided_study", annualCents: 300000 },
  ],
  planKinds: ["full", "two_payments", "quarterly", "monthly"],
  standardFees: [
    { chargeType: "facility", label: "Facility fee", amountCents: 30000 },
    { chargeType: "activity", label: "Activity fee", amountCents: 15000 },
    { chargeType: "lunch", label: "Lunch program", amountCents: 45000 },
  ],
  reenrollmentWindow: { opens: "2026-01-15", deadline: "2026-03-01" },
};
