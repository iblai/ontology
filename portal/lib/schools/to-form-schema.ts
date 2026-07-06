import type {
  FormField,
  FormSchema,
  FormSection,
  VisibleIf,
} from "@iblai/iblai-js/data-layer";
import type { SchoolConfig } from "./types";
import { GRADE_LEVELS } from "./types";

// SchoolConfig → gate FormSchema (guide §4). Five sections: family, students
// (repeatable), agreements, signatures, and medical (network schools only).
// The SDK's ApplicationFormRenderer renders one section per step.

const GRADE_LEVEL_OPTIONS = GRADE_LEVELS.map((g) => ({
  value: g,
  label: g === "K" ? "Kindergarten" : `Grade ${g}`,
}));

function textField(key: string, label: string, required = false): FormField {
  return { key, type: "text", label, required };
}

function emailField(key: string, label: string, required = false): FormField {
  return { key, type: "email", label, required };
}

function phoneField(key: string, label: string, required = false): FormField {
  return { key, type: "phone", label, required };
}

function textareaField(key: string, label: string, required = false): FormField {
  return { key, type: "textarea", label, required };
}

function dateField(key: string, label: string, required = false): FormField {
  return { key, type: "date", label, required };
}

function selectField(
  key: string,
  label: string,
  options: { value: string; label: string }[],
  required = false,
): FormField {
  return { key, type: "select", label, required, options };
}

function yesNoField(key: string, label: string, required = false): FormField {
  return selectField(
    key,
    label,
    [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ],
    required,
  );
}

function booleanField(
  key: string,
  label: string,
  required = false,
  helpText?: string,
): FormField {
  return {
    key,
    type: "boolean",
    label,
    required,
    help_text: helpText,
    must_be_true: required ? true : undefined,
  };
}

function signatureField(key: string, label: string): FormField {
  return { key, type: "signature", label, required: true };
}

function guardianFieldSet(prefix: string, required: boolean): FormField[] {
  return [
    textField(`${prefix}_first_name`, "First Name", required),
    textField(`${prefix}_last_name`, "Last Name", required),
    textField(`${prefix}_relationship`, "Relationship to Student", required),
    emailField(`${prefix}_email`, "Email Address", required),
    phoneField(`${prefix}_phone`, "Phone Number", required),
    phoneField(`${prefix}_secondary_phone`, "Secondary Phone", false),
    textField(`${prefix}_street`, "Street Address", required),
    textField(`${prefix}_city`, "City", required),
    textField(`${prefix}_state`, "State", required),
    textField(`${prefix}_zip`, "ZIP Code", required),
  ];
}

function questionField(q: SchoolConfig["familyQuestions"][number], required = false): FormField {
  if (q.kind === "textarea") return textareaField(q.id, q.label, required);
  if (q.kind === "yesno") return yesNoField(q.id, q.label, required);
  if (q.kind === "select" && q.options) {
    return selectField(
      q.id,
      q.label,
      q.options.map((o) => ({ value: o, label: o })),
      required,
    );
  }
  return textField(q.id, q.label, required);
}

export function buildFormSchema(cfg: SchoolConfig): FormSchema {
  const sections: FormSection[] = [];

  // 1. Family — guardian 1 (required), guardian 2 (optional), family background.
  sections.push({
    key: "guardians_family",
    title: "Family Information",
    description: "Tell us about the parent(s)/guardian(s) and your family background.",
    repeatable: false,
    fields: [
      ...guardianFieldSet("guardian1", true),
      ...guardianFieldSet("guardian2", false),
      ...cfg.familyQuestions.map((q) => questionField(q, q.required ?? false)),
    ],
  });

  // Student-response questions, the unique student email, and the student
  // signature only apply to grades 3–12 (§3: "should not display for students
  // entering kindergarten through second grade"). `visible_if` is a single
  // condition, so use `in` with the explicit grade list. A bare `grade_level`
  // key resolves against the same repeatable student entry (VisibleIf doc).
  const gradesThreeToTwelve: VisibleIf = {
    field: "grade_level",
    operator: "in",
    value: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
  };

  // 2. Students — repeatable, one entry per child.
  sections.push({
    key: "students",
    title: "Students",
    description:
      "Add each child applying. Students in grades 3–12 answer additional questions.",
    repeatable: true,
    min_items: 1,
    max_items: 10,
    item_label: "Student",
    fields: [
      textField("legal_first_name", "Legal First Name", true),
      textField("legal_last_name", "Legal Last Name", true),
      textField("preferred_name", "Preferred Name or Nickname"),
      {
        key: "email",
        type: "email",
        label: "Student Email Address",
        required: false,
        help_text: "Students in grades 3–12 need a unique email address.",
        visible_if: gradesThreeToTwelve,
      },
      dateField("date_of_birth", "Date of Birth", true),
      selectField(
        "gender",
        "Gender",
        [
          { value: "female", label: "Female" },
          { value: "male", label: "Male" },
        ],
        true,
      ),
      selectField(
        "grade_level",
        `Grade Level Entering for ${cfg.programYear}`,
        GRADE_LEVEL_OPTIONS,
        true,
      ),
      selectField(
        "program",
        "Program Selection",
        cfg.programs.map((p) => ({ value: p.id, label: p.label })),
        true,
      ),
      textareaField("support_info", "Student Support Information"),
      ...cfg.academicBackgroundQuestions.map((q) => questionField(q)),
      ...cfg.studentResponseQuestions.map((q) => ({
        ...questionField(q),
        visible_if: gradesThreeToTwelve,
      })),
      ...(cfg.requiresPhotoMediaRelease
        ? [yesNoField("photo_media_release", "Photo and Media Release", true)]
        : []),
    ],
  });

  // 3. Agreements — required acknowledgments (must_be_true), with doc links.
  sections.push({
    key: "agreements",
    title: "Agreements & Acknowledgments",
    description: "Please read and acknowledge each statement.",
    fields: cfg.agreements.map((a) =>
      booleanField(
        a.id,
        a.label,
        a.required,
        a.documentUrl
          ? `Review: ${a.documentUrl}${
              a.id.includes("handbook") ? ` · Handbook version ${cfg.handbook.version}` : ""
            }`
          : undefined,
      ),
    ),
  });

  // 4. Signatures — primary always; co-parent/student per school config.
  const sigFields: FormField[] = [
    signatureField("primary_parent", "Primary Parent/Guardian Signature"),
  ];
  if (cfg.signatures.coParent) {
    sigFields.push(signatureField("co_parent", "Spouse / Co-Parent Signature"));
  }
  if (cfg.signatures.student) {
    sigFields.push({
      ...signatureField("student", "Student Signature (grades 3–12)"),
      required: false,
      visible_if: gradesThreeToTwelve,
    });
  }
  sections.push({
    key: "signatures",
    title: "Signatures",
    description:
      "Type your full name to sign electronically. The date is recorded automatically.",
    fields: sigFields,
  });

  // 5. Medical release — network schools only; flagged sensitive.
  if (cfg.requiresMedicalRelease) {
    sections.push({
      key: "medical",
      title: "Medical Release",
      description:
        "Medical information is protected and visible only to authorized school personnel.",
      sensitive: true,
      fields: [
        textField("emergency_contact_name", "Emergency Contact Name", true),
        phoneField("emergency_contact_phone", "Emergency Contact Phone", true),
        textField(
          "emergency_contact_relationship",
          "Emergency Contact Relationship to Student",
          true,
        ),
        textField("physician", "Preferred Physician or Clinic"),
        textField("insurance_provider", "Insurance Provider"),
        textField("policy_number", "Policy Number"),
        booleanField("treatment_authorized", "I authorize emergency medical treatment.", true),
        dateField("effective_from", "Medical Authorization Effective From", true),
        dateField("effective_to", "Medical Authorization Effective To", true),
      ],
    });
  }

  return {
    title: `Apply to ${cfg.name}`,
    description: cfg.intro,
    sections,
    resources: cfg.handbook.url ? [{ label: "Family Handbook", url: cfg.handbook.url }] : [],
  };
}
