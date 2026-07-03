import type { SchoolConfig } from "./types";

// American Faith Academy — fully online school. PDF §3.
export const afa: SchoolConfig = {
  slug: "afa",
  name: "American Faith Academy",
  shortName: "AFA",
  logo: "/afa-logo.svg",
  accentColor: "#1e3a8a",
  model: "afa",
  programYear: "2026-2027",
  intro:
    "Apply to American Faith Academy — a fully online, Christ-centered classical school. Complete one application for your whole family; add each child in the Students step.",
  announcements: [
    "Placement testing in Math and Language Arts follows acceptance and enrollment.",
    "Students in grades 3–12 receive a unique school email address.",
  ],

  programs: [
    {
      id: "full_academic",
      label: "Full Academic Program",
      description: "Complete course load for the year.",
    },
    {
      id: "soar_essentials",
      label: "SOAR Essentials Program",
      description: "Math and Language Arts only.",
    },
    {
      id: "individual_course",
      label: "Individual Course",
      description: "Select a single course.",
      requiresCourseSelection: true,
    },
  ],

  familyQuestions: [
    // Referral Information
    {
      id: "referral_source",
      label: "How did you hear about American Faith Academy?",
      kind: "text",
    },
    {
      id: "referral_name",
      label: "If someone referred you, please provide their name.",
      kind: "text",
    },
    // Family and Faith Background
    {
      id: "church_involvement",
      label: "Please briefly describe your family's involvement in your church or faith community.",
      kind: "textarea",
      required: true,
    },
    {
      id: "faith_relationship",
      label:
        "Please describe your family's relationship with the Lord and how your faith influences your daily life.",
      kind: "textarea",
      required: true,
    },
    {
      id: "why_afa",
      label: "Why have you chosen to pursue enrollment at American Faith Academy?",
      kind: "textarea",
      required: true,
    },
  ],

  academicBackgroundQuestions: [
    {
      id: "recent_experience",
      label: "Tell us about this student's recent educational experience.",
      kind: "textarea",
    },
    {
      id: "current_school",
      label: "Where is this student currently attending school?",
      kind: "text",
    },
    { id: "curriculum", label: "What curriculum is being used?", kind: "text" },
    { id: "subjects", label: "What subjects are being studied?", kind: "text" },
    {
      id: "challenge_level",
      label: "What level of academic challenge is this student experiencing?",
      kind: "text",
    },
    {
      id: "hours_per_day",
      label: "How many hours per day does this student typically spend on schoolwork?",
      kind: "text",
    },
    {
      id: "academic_strengths",
      label: "What are this student's greatest academic strengths?",
      kind: "textarea",
    },
    {
      id: "growth_areas",
      label: "What academic areas need the most growth or support?",
      kind: "textarea",
    },
    {
      id: "character_strengths",
      label: "What are this student's greatest character strengths?",
      kind: "textarea",
    },
    {
      id: "character_growth",
      label: "What character traits would you like to see further developed?",
      kind: "textarea",
    },
    {
      id: "anything_else",
      label:
        "Is there anything else you would like us to know about this student or family as we consider your application?",
      kind: "textarea",
    },
  ],

  studentResponseQuestions: [
    {
      id: "why_student",
      label: "Why would you like to become a student at American Faith Academy?",
      kind: "textarea",
    },
    {
      id: "improve_area",
      label: "What academic area would you most like to improve this year?",
      kind: "textarea",
    },
    {
      id: "long_term_goals",
      label: "What are your long-term educational goals and career aspirations?",
      kind: "textarea",
    },
    {
      id: "interests",
      label:
        "What interests, hobbies, activities, or extracurricular pursuits do you enjoy outside of school?",
      kind: "textarea",
    },
    {
      id: "faith_daily_life",
      label:
        "Tell us about your relationship with Jesus Christ and how your faith affects your daily life.",
      kind: "textarea",
    },
  ],

  agreements: [
    {
      id: "statement_of_faith",
      label:
        "I have read and reviewed the American Faith Academy Statement of Faith and Values in its entirety.",
      documentUrl: "https://americanfaithacademy.org/statement-of-faith",
      required: true,
    },
    {
      id: "christian_institution",
      label:
        "I understand that American Faith Academy is a Christian educational institution founded upon biblical principles and classical education.",
      required: true,
    },
    {
      id: "support_mission",
      label:
        "I agree to support the mission and values of the school and will not undermine its foundational beliefs.",
      required: true,
    },
    {
      id: "honor_code",
      label: "I commit to supporting my child in upholding the school's Honor Code.",
      documentUrl: "https://americanfaithacademy.org/honor-code",
      required: true,
    },
    {
      id: "honor_code_violations",
      label:
        "I understand that violations of the Honor Code may result in disciplinary action, including possible dismissal.",
      required: true,
    },
    {
      id: "equipment_responsibility",
      label:
        "I acknowledge my responsibility to provide the equipment, materials, and support necessary for my child's education.",
      required: true,
    },
    {
      id: "abide_policies",
      label: "I agree to abide by all school policies and procedures.",
      documentUrl: "https://americanfaithacademy.org/handbook",
      required: true,
    },
  ],
  signatures: { primaryParent: true, coParent: false, student: false },
  requiresMedicalRelease: false,
  requiresPhotoMediaRelease: false,
  interviewRequiredByDefault: false,

  fee: {
    // ponytail: placeholder amounts — real fees come from product.
    amountCents: 15000,
    basis: "family",
    refundability: "nonrefundable",
  },

  handbook: {
    url: "https://americanfaithacademy.org/handbook",
    version: "2026-2027 v1",
  },
  decisionTemplates: {
    acceptance:
      "Dear {{parentName}}, we are delighted to offer {{studentNames}} a place at American Faith Academy for the {{programYear}} school year. Your next step is to complete financial enrollment and select a payment plan in the portal.",
    declination:
      "Dear {{parentName}}, after careful and prayerful review we are unable to offer {{studentNames}} a place at American Faith Academy at this time. We appreciate your interest in our community.",
    waitlist:
      "Dear {{parentName}}, {{studentNames}} has been placed on our waitlist for the {{programYear}} school year. We will contact you should a place become available.",
  },
  tuition: [
    { gradeBand: "K-5", programId: "full_academic", annualCents: 450000 },
    { gradeBand: "6-8", programId: "full_academic", annualCents: 495000 },
    { gradeBand: "9-12", programId: "full_academic", annualCents: 550000 },
    { gradeBand: "K-12", programId: "soar_essentials", annualCents: 250000 },
    { gradeBand: "K-12", programId: "individual_course", annualCents: 90000 },
  ],
  planKinds: ["full", "two_payments", "monthly"],
  standardFees: [
    { chargeType: "technology", label: "Technology fee", amountCents: 12000 },
    { chargeType: "curriculum", label: "Curriculum fee", amountCents: 20000 },
  ],
  reenrollmentWindow: { opens: "2026-02-01", deadline: "2026-03-15" },
};
