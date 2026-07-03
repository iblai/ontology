import type { FamilyApplicationView, DraftPatch } from "@/lib/api";
import type {
  Acknowledgment,
  Guardian,
  MedicalRelease,
  Signature,
  StudentApplication,
} from "@/lib/types";
import { showsStudentResponses, type SchoolConfig } from "@/lib/schools";

export interface WizardSignatures {
  primaryName: string;
  primarySig: string;
  coName: string;
  coSig: string;
  studentName: string;
  studentSig: string;
}

export interface WizardForm {
  guardian1: Guardian;
  guardian2: Guardian;
  familyAnswers: Record<string, string>;
  students: StudentApplication[];
  acknowledgments: Acknowledgment[];
  photoMediaRelease: "Yes" | "No" | "";
  medicalRelease: MedicalRelease;
  sigs: WizardSignatures;
}

export function emptyGuardian(): Guardian {
  return {
    firstName: "",
    lastName: "",
    relationship: "",
    email: "",
    phone: "",
    secondaryPhone: "",
    address: { street: "", city: "", state: "", zip: "" },
  };
}

export function emptyMedicalRelease(): MedicalRelease {
  return {
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
    physician: "",
    insuranceProvider: "",
    policyNumber: "",
    treatmentAuthorized: false,
    effectiveFrom: "",
    effectiveTo: "",
  };
}

export function blankWizardStudent(): StudentApplication {
  return {
    id: `stu_${crypto.randomUUID().slice(0, 8)}`,
    status: "draft",
    legalFirstName: "",
    legalLastName: "",
    preferredName: "",
    email: "",
    dateOfBirth: "",
    gender: "",
    gradeLevel: "",
    program: "",
    individualCourse: "",
    supportInfo: "",
    academicBackground: {},
    studentResponses: {},
    placement: {
      math: { status: "not_assigned" },
      languageArts: { status: "not_assigned" },
    },
    courseEnrollments: [],
  };
}

export function formFromDraft(draft: FamilyApplicationView, cfg: SchoolConfig): WizardForm {
  const findSig = (role: Signature["role"]) => draft.signatures.find((s) => s.role === role);
  const p = findSig("primary_parent");
  const c = findSig("co_parent");
  const s = findSig("student");
  const photo = draft.students.find((st) => st.photoMediaRelease !== undefined);
  return {
    guardian1: draft.guardians[0] ?? emptyGuardian(),
    guardian2: draft.guardians[1] ?? emptyGuardian(),
    familyAnswers: { ...draft.familyAnswers },
    students: draft.students.length
      ? draft.students.map((st) => ({ ...st }))
      : [blankWizardStudent()],
    acknowledgments: cfg.agreements.map((ag) => {
      const existing = draft.acknowledgments.find((a) => a.id === ag.id);
      return (
        existing ?? {
          id: ag.id,
          label: ag.label,
          documentUrl: ag.documentUrl,
          checked: false,
        }
      );
    }),
    photoMediaRelease: photo ? (photo.photoMediaRelease ? "Yes" : "No") : "",
    medicalRelease: draft.medicalRelease ?? emptyMedicalRelease(),
    sigs: {
      primaryName: p?.signerName ?? "",
      primarySig: p?.signature ?? "",
      coName: c?.signerName ?? "",
      coSig: c?.signature ?? "",
      studentName: s?.signerName ?? "",
      studentSig: s?.signature ?? "",
    },
  };
}

function guardianFilled(g: Guardian): boolean {
  return Boolean(g.firstName || g.lastName || g.email || g.phone || g.address.street);
}

export function patchFromForm(form: WizardForm, cfg: SchoolConfig): DraftPatch {
  const guardians = [form.guardian1];
  if (guardianFilled(form.guardian2)) guardians.push(form.guardian2);

  const signatures: Signature[] = [];
  const push = (role: Signature["role"], name: string, sig: string) => {
    if (name.trim() && sig.trim()) {
      signatures.push({
        role,
        signerName: name.trim(),
        signature: sig.trim(),
        signedAt: new Date().toISOString(),
      });
    }
  };
  push("primary_parent", form.sigs.primaryName, form.sigs.primarySig);
  push("co_parent", form.sigs.coName, form.sigs.coSig);
  push("student", form.sigs.studentName, form.sigs.studentSig);

  return {
    guardians,
    familyAnswers: form.familyAnswers,
    students: form.students.map((s) => ({
      ...s,
      photoMediaRelease: cfg.requiresPhotoMediaRelease
        ? form.photoMediaRelease === "Yes"
        : undefined,
    })),
    acknowledgments: form.acknowledgments,
    signatures,
    medicalRelease: cfg.requiresMedicalRelease ? form.medicalRelease : undefined,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Steps: 1=family, 2=students, 3=agreements. Returns fieldPath → error key suffix. */
export function validateStep(
  step: number,
  form: WizardForm,
  cfg: SchoolConfig,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const req = (path: string, value: string | undefined) => {
    if (!value || !value.trim()) errors[path] = "required";
  };

  if (step === 1) {
    const g = form.guardian1;
    req("g1.firstName", g.firstName);
    req("g1.lastName", g.lastName);
    req("g1.relationship", g.relationship);
    req("g1.email", g.email);
    if (g.email && !EMAIL_RE.test(g.email)) errors["g1.email"] = "invalidEmail";
    req("g1.phone", g.phone);
    req("g1.street", g.address.street);
    req("g1.city", g.address.city);
    req("g1.state", g.address.state);
    req("g1.zip", g.address.zip);
    if (guardianFilled(form.guardian2)) {
      req("g2.firstName", form.guardian2.firstName);
      req("g2.lastName", form.guardian2.lastName);
      req("g2.email", form.guardian2.email);
      if (form.guardian2.email && !EMAIL_RE.test(form.guardian2.email)) {
        errors["g2.email"] = "invalidEmail";
      }
    }
    for (const q of cfg.familyQuestions) {
      if (q.required) req(`fq.${q.id}`, form.familyAnswers[q.id]);
    }
  }

  if (step === 2) {
    form.students.forEach((s, i) => {
      req(`s${i}.legalFirstName`, s.legalFirstName);
      req(`s${i}.legalLastName`, s.legalLastName);
      req(`s${i}.dateOfBirth`, s.dateOfBirth);
      if (s.dateOfBirth && isNaN(new Date(s.dateOfBirth).getTime())) {
        errors[`s${i}.dateOfBirth`] = "invalidDate";
      }
      req(`s${i}.gender`, s.gender);
      req(`s${i}.gradeLevel`, s.gradeLevel);
      req(`s${i}.program`, s.program);
      const program = cfg.programs.find((p) => p.id === s.program);
      if (program?.requiresCourseSelection) {
        req(`s${i}.individualCourse`, s.individualCourse);
      }
      // AFA: unique student email required for grades 3–12 (PDF §3).
      if (cfg.model === "afa" && s.gradeLevel && showsStudentResponses(s.gradeLevel)) {
        req(`s${i}.email`, s.email);
        if (s.email && !EMAIL_RE.test(s.email)) errors[`s${i}.email`] = "invalidEmail";
      }
    });
  }

  if (step === 3) {
    for (const ack of form.acknowledgments) {
      const agreement = cfg.agreements.find((a) => a.id === ack.id);
      if (agreement?.required && !ack.checked) errors[`ack.${ack.id}`] = "required";
    }
    if (cfg.requiresPhotoMediaRelease && !form.photoMediaRelease) {
      errors["photoMediaRelease"] = "required";
    }
    if (cfg.requiresMedicalRelease) {
      const m = form.medicalRelease;
      req("med.emergencyContactName", m.emergencyContactName);
      req("med.emergencyContactPhone", m.emergencyContactPhone);
      req("med.emergencyContactRelationship", m.emergencyContactRelationship);
      req("med.effectiveFrom", m.effectiveFrom);
      req("med.effectiveTo", m.effectiveTo);
    }
    req("sig.primaryName", form.sigs.primaryName);
    req("sig.primarySig", form.sigs.primarySig);
    const hasG2 = guardianFilled(form.guardian2);
    if (cfg.signatures.coParent && hasG2) {
      req("sig.coName", form.sigs.coName);
      req("sig.coSig", form.sigs.coSig);
    }
    const hasOlderStudent = form.students.some(
      (s) => s.gradeLevel && showsStudentResponses(s.gradeLevel),
    );
    if (cfg.signatures.student && hasOlderStudent) {
      req("sig.studentName", form.sigs.studentName);
      req("sig.studentSig", form.sigs.studentSig);
    }
  }

  return errors;
}
