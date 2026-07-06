// Self-check for the mock API workflow rules (PLAN M2 acceptance).
// Run: pnpm dlx tsx lib/api/__demo__.ts
import assert from "node:assert/strict";
import {
  changeStatus,
  createDraft,
  getApplication,
  getApplicationForFamily,
  getFamilyAccount,
  listInvoices,
  listSisRecords,
  payFee,
  recordDecision,
  recordInterviewOutcome,
  selectPaymentPlan,
  setActor,
  submitApplication,
  updateDraft,
  accountBalance,
  addInternalNote,
} from "./index";
import type { Guardian } from "../types";

const admin = {
  id: "admin_central",
  name: "Test Admin",
  role: "central_admin" as const,
};

const guardian: Guardian = {
  firstName: "Test",
  lastName: "Parent",
  relationship: "Mother",
  email: "test.parent@example.com",
  phone: "555-0100",
  address: { street: "1 Test St", city: "Testville", state: "MO", zip: "65000" },
};

async function fillDraft(id: string, schoolSlug: string) {
  const view = await getApplicationForFamily(id);
  await updateDraft(id, {
    guardians: [guardian],
    students: view.students.map((s) => ({
      ...s,
      legalFirstName: "Kid",
      legalLastName: "Parent",
      dateOfBirth: "2018-01-01",
      gender: "Female",
      gradeLevel: "4",
      program: schoolSlug === "afa" ? "full_academic" : "academic",
    })),
    acknowledgments: view.acknowledgments.map((a) => ({ ...a, checked: true })),
    signatures: [
      {
        role: "primary_parent",
        signerName: "Test Parent",
        signature: "Test Parent",
        signedAt: new Date().toISOString(),
      },
    ],
  });
}

async function main() {
  setActor(admin);

  // 1. Draft cannot submit until acks/signature/fee are complete. PDF §2.1/§5.1.
  const draft = await createDraft("afa", "test.parent@example.com");
  await assert.rejects(() => submitApplication(draft.id), /Cannot submit/);

  await fillDraft(draft.id, "afa");
  await assert.rejects(() => submitApplication(draft.id), /fee/i);
  await payFee(draft.id);
  const submitted = await submitApplication(draft.id);
  assert.equal(submitted.status, "submitted");

  // 2. History logs every hop with user; illegal transitions throw. PDF §2.2.
  await assert.rejects(() => changeStatus(draft.id, "enrolled"), /Illegal/);
  await changeStatus(draft.id, "under_review");
  const afterReview = await getApplication(draft.id);
  assert.equal(afterReview.status, "under_review");
  assert.ok(afterReview.history.some((h) => h.to === "under_review" && h.by === "Test Admin"));

  // 3. Accept → SIS records + billing account with tuition. PDF §2.5, §7.
  await recordDecision(draft.id, [], "acceptance");
  const accepted = await getApplication(draft.id);
  assert.equal(accepted.status, "accepted");
  const sis = await listSisRecords();
  assert.ok(sis.some((r) => r.sourceApplicationId === draft.id && r.kind === "student"));
  const account = await getFamilyAccount(draft.id);
  assert.ok(account, "account created on acceptance");
  assert.ok(accountBalance(account!) > 0, "tuition charged");

  // 4. Payment plan → invoices cover the balance; status advances. PDF §7.1.
  const balance = accountBalance(account!);
  await selectPaymentPlan(account!.id, "monthly");
  const invoices = await listInvoices(account!.id);
  assert.equal(
    invoices.reduce((s, i) => s + i.amountCents, 0),
    balance,
  );
  assert.equal((await getApplication(draft.id)).status, "enrollment_in_progress");

  // 5. Interview gate: network school cannot accept before outcome/waiver. PDF §2.3.
  const grace = await createDraft("grace-network", "test.parent@example.com");
  await fillDraft(grace.id, "grace-network");
  await payFee(grace.id);
  await submitApplication(grace.id);
  await changeStatus(grace.id, "under_review");
  await changeStatus(grace.id, "interview_required");
  await assert.rejects(() => changeStatus(grace.id, "accepted"), /interview/i);
  await recordInterviewOutcome(grace.id, "proceed");
  await changeStatus(grace.id, "accepted");

  // 6. Declined applicants never create SIS records. PDF §2.5.
  const declined = await createDraft("afa", "declined.family@example.com");
  await fillDraft(declined.id, "afa");
  await payFee(declined.id);
  await submitApplication(declined.id);
  await changeStatus(declined.id, "under_review");
  await recordDecision(declined.id, [], "declination");
  const sisAfter = await listSisRecords();
  assert.ok(!sisAfter.some((r) => r.sourceApplicationId === declined.id));

  // 7. Privacy: family view never carries internal/interview notes. PDF §2.2/§2.3.
  await addInternalNote(grace.id, "SECRET internal note");
  const familyView = await getApplicationForFamily(grace.id);
  const json = JSON.stringify(familyView);
  assert.ok(!json.includes("SECRET"), "internal notes stripped");
  assert.ok(!("internalNotes" in familyView));
  assert.ok(!json.includes('"note"'), "history notes stripped");
  assert.ok(familyView.interview && !("notes" in familyView.interview));

  console.log("api self-check: all assertions passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
