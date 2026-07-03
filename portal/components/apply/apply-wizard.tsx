"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/page-header";
import { Stepper } from "@/components/shared/stepper";
import { StatusBadge } from "@/components/shared/status-badge";
import { StepFamily } from "./step-family";
import { StepStudents } from "./step-students";
import { StepAgreements } from "./step-agreements";
import { StepReview } from "./step-review";
import { formFromDraft, patchFromForm, validateStep, type WizardForm } from "./wizard-state";
import {
  createDraft,
  getApplicationForFamily,
  getDraftsByEmail,
  getSchool,
  payFee,
  submitApplication,
  updateDraft,
  type FamilyApplicationView,
} from "@/lib/api";
import type { SchoolConfig } from "@/lib/schools";
import { fmtDate } from "@/lib/format";

const storageKey = (slug: string) => `apply-draft-${slug}`;

export function ApplyWizard({ slug }: { slug: string }) {
  const t = useTranslations("apply");
  const router = useRouter();

  const [cfg, setCfg] = useState<SchoolConfig | null | "missing">(null);
  const [draft, setDraft] = useState<FamilyApplicationView | null>(null);
  const [form, setForm] = useState<WizardForm | null>(null);
  const [step, setStep] = useState(0); // 0 welcome, 1 family, 2 students, 3 agreements, 4 review
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // welcome state
  const [email, setEmail] = useState("");
  const [foundDrafts, setFoundDrafts] = useState<FamilyApplicationView[] | null>(null);
  const [storedDraft, setStoredDraft] = useState<FamilyApplicationView | null>(null);

  useEffect(() => {
    (async () => {
      let config: SchoolConfig;
      try {
        config = await getSchool(slug);
      } catch {
        setCfg("missing");
        return;
      }
      setCfg(config);

      const urlDraft = new URLSearchParams(window.location.search).get("draft");
      const savedId = urlDraft ?? window.localStorage.getItem(storageKey(slug));
      if (!savedId) return;
      try {
        const existing = await getApplicationForFamily(savedId);
        if (existing.schoolSlug !== slug) return;
        if (existing.status === "draft" || existing.status === "incomplete") {
          if (urlDraft) {
            // Direct link (re-enrollment / "continue editing") — jump straight in.
            openDraft(existing, config);
          } else {
            setStoredDraft(existing);
          }
        }
      } catch {
        window.localStorage.removeItem(storageKey(slug));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const openDraft = (d: FamilyApplicationView, config: SchoolConfig) => {
    window.localStorage.setItem(storageKey(slug), d.id);
    setDraft(d);
    setForm(formFromDraft(d, config));
    setStep(1);
  };

  if (cfg === null) return null;
  if (cfg === "missing") {
    return (
      <div className="mx-auto max-w-xl p-10">
        <EmptyState title={t("schoolNotFound")} />
      </div>
    );
  }

  const startNew = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("enterValidEmail"));
      return;
    }
    setBusy(true);
    try {
      const d = await createDraft(slug, email);
      openDraft(d, cfg);
    } finally {
      setBusy(false);
    }
  };

  const findDrafts = async () => {
    if (!email.trim()) return;
    setFoundDrafts(await getDraftsByEmail(email));
  };

  const saveDraft = async (silent = false): Promise<FamilyApplicationView | null> => {
    if (!draft || !form) return null;
    try {
      const updated = await updateDraft(draft.id, patchFromForm(form, cfg));
      setDraft(updated);
      if (!silent) toast.success(t("draftSaved"));
      return updated;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  };

  const next = async () => {
    if (!form) return;
    const errs = validateStep(step, form, cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error(t("fixErrors", { n: Object.keys(errs).length }));
      return;
    }
    setBusy(true);
    const saved = await saveDraft(true);
    setBusy(false);
    if (saved) setStep(step + 1);
  };

  const back = async () => {
    await saveDraft(true);
    setErrors({});
    setStep(step - 1);
  };

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await saveDraft(true);
      if (!saved) return;
      await submitApplication(draft.id);
      window.localStorage.removeItem(storageKey(slug));
      router.push(`/apply/${slug}/status?id=${draft.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      setDraft(await payFee(draft.id));
      toast.success(t("feePaidToast"));
    } finally {
      setBusy(false);
    }
  };

  const steps = [t("stepFamily"), t("stepStudents"), t("stepAgreements"), t("stepReview")];

  return (
    <div className="min-h-dvh bg-[#fafafa]">
      {/* Branded school header */}
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4">
          <Image
            src={cfg.logo}
            alt={cfg.name}
            width={180}
            height={40}
            className="h-10 w-auto object-contain"
          />
          <div className="flex-1" />
          <Badge variant="secondary">{t("enrollmentYear", { year: cfg.programYear })}</Badge>
          {step >= 1 && (
            <Button variant="outline" size="sm" onClick={() => saveDraft()}>
              <Save className="size-3.5" />
              {t("saveAndExit")}
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {step === 0 && (
          <div className="mx-auto max-w-xl space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-semibold">{t("welcomeTitle", { school: cfg.name })}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{cfg.intro}</p>
            </div>

            {draft?.isReenrollment && (
              <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
                {t("reenrollmentBanner")}
              </p>
            )}

            {storedDraft && (
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div>
                    <p className="text-sm font-medium">
                      {t("savedDraftFound")} <StatusBadge status={storedDraft.status} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {storedDraft.id} · {t("startedOn", { date: fmtDate(storedDraft.createdAt) })}
                    </p>
                  </div>
                  <Button onClick={() => openDraft(storedDraft, cfg)}>{t("continueDraft")}</Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="space-y-4 py-6">
                <div className="space-y-1.5">
                  <Label>{t("parentEmail")}</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                  <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={startNew}
                    style={{ backgroundColor: cfg.accentColor }}
                    className="text-white hover:opacity-90"
                  >
                    {t("startApplication")}
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={findDrafts}>
                    {t("resumeSaved")}
                  </Button>
                </div>
                {foundDrafts && foundDrafts.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("noDraftsFound")}</p>
                )}
                {foundDrafts?.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => openDraft(d, cfg)}
                    className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm hover:border-primary/40"
                  >
                    <span>
                      {d.id}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("studentsCount", { n: d.students.length })}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </CardContent>
            </Card>

            {cfg.announcements.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {cfg.announcements.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            <p className="text-center text-xs text-muted-foreground">
              {t("alreadySubmitted")}{" "}
              <Link href="/login" className="text-primary hover:underline">
                {t("signIn")}
              </Link>
            </p>
          </div>
        )}

        {step >= 1 && form && draft && (
          <div className="space-y-6">
            <Stepper
              steps={steps}
              current={step - 1}
              accent={cfg.accentColor}
              onStepClick={(i) => setStep(i + 1)}
            />

            {draft.status === "incomplete" && draft.infoRequests.some((r) => !r.resolvedAt) && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                {t("incompleteBanner")}{" "}
                {draft.infoRequests
                  .filter((r) => !r.resolvedAt)
                  .map((r) => r.items)
                  .join(" ")}
              </p>
            )}

            <Card>
              <CardContent className="py-6">
                {step === 1 && (
                  <StepFamily form={form} setForm={setForm} cfg={cfg} errors={errors} />
                )}
                {step === 2 && (
                  <StepStudents form={form} setForm={setForm} cfg={cfg} errors={errors} />
                )}
                {step === 3 && (
                  <StepAgreements form={form} setForm={setForm} cfg={cfg} errors={errors} />
                )}
                {step === 4 && (
                  <StepReview
                    form={form}
                    cfg={cfg}
                    draft={draft}
                    onEdit={(s) => setStep(s)}
                    onPay={pay}
                    paying={busy}
                  />
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={back} disabled={busy}>
                <ArrowLeft className="size-4" />
                {t("back")}
              </Button>
              {step < 4 ? (
                <Button
                  onClick={next}
                  disabled={busy}
                  style={{ backgroundColor: cfg.accentColor }}
                  className="text-white hover:opacity-90"
                >
                  {t("next")}
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  disabled={busy || (draft.fee.amountCents > 0 && draft.fee.status === "unpaid")}
                  style={{ backgroundColor: cfg.accentColor }}
                  className="text-white hover:opacity-90"
                >
                  {t("submitApplication")}
                </Button>
              )}
            </div>
            {step === 4 && draft.fee.amountCents > 0 && draft.fee.status === "unpaid" && (
              <p className="text-right text-xs text-muted-foreground">{t("payBeforeSubmit")}</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
