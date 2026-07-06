"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/page-header";
import { getSchoolConfig } from "@/lib/schools";
import { money } from "@/lib/format";

// The SDK's web-containers bundle is client-only (touches browser APIs at init),
// so load it via next/dynamic with ssr:false to keep server rendering clean.
const Spinner = () => (
  <div className="flex items-center justify-center py-20">
    <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

const ApplicationGateEntry = dynamic(
  () => import("@iblai/iblai-js/web-containers").then((m) => m.ApplicationGateEntry),
  { ssr: false, loading: Spinner },
);

const ApplicationFormRenderer = dynamic(
  () => import("@iblai/iblai-js/web-containers").then((m) => m.ApplicationFormRenderer),
  { ssr: false, loading: Spinner },
);

type Mode = "gate" | "form" | "done";

// The apply UI, powered by the SDK's schema-driven ApplicationFormRenderer and
// ApplicationGateEntry (wired to the mock gate API under app/api/catalog/*).
// The portal keeps ownership of the school branding chrome and the application
// fee (fees are out of the gate API's scope — SDK_PLAN §7).
export function SdkApplyWizard({ platformKey }: { platformKey: string }) {
  const cfg = getSchoolConfig(platformKey);

  const [mode, setMode] = useState<Mode>("gate");
  const [submissionId, setSubmissionId] = useState<number | string | undefined>();
  const [submittedId, setSubmittedId] = useState<number | string | undefined>();

  const feeRequired = (cfg?.fee.amountCents ?? 0) > 0;
  const feeStorageKey = `apply-fee-${platformKey}`;
  const [feePaid, setFeePaid] = useState(false);
  const [feeDialogOpen, setFeeDialogOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setFeePaid(window.localStorage.getItem(feeStorageKey) === "paid");
  }, [feeStorageKey]);

  if (!cfg) {
    return (
      <div className="mx-auto max-w-xl p-10">
        <EmptyState title="School not found." />
      </div>
    );
  }

  const payFee = () => {
    // ponytail: mock processor — any input succeeds. Fees live on the portal
    // side; the gate API has no fee concept.
    window.localStorage.setItem(feeStorageKey, "paid");
    setFeePaid(true);
    setFeeDialogOpen(false);
    toast.success("Fee paid — you can submit now.");
  };

  const feeAmount = money(cfg.fee.amountCents);

  return (
    <div className="sdk-apply">
      {/* School-branding sub-bar — sits below the global ibl.ai NavBar. */}
      <div className="mx-auto flex max-w-3xl items-center gap-3 border-b px-4 py-3">
        <Image
          src={cfg.logo}
          alt={cfg.name}
          width={160}
          height={36}
          className="h-8 w-auto object-contain"
        />
        <div className="flex-1" />
        <Badge variant="secondary">{cfg.programYear} Enrollment</Badge>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {mode === "gate" && (
          <ApplicationGateEntry
            platformKey={platformKey}
            onJoin={() => toast.info("This platform is open — self-join flow.")}
            onApply={(action, id) => {
              setSubmissionId(action === "resume" ? id : undefined);
              setMode("form");
            }}
          />
        )}

        {mode === "form" && (
          <div className="space-y-6">
            <ApplicationFormRenderer
              platformKey={platformKey}
              submissionId={submissionId}
              onBeforeSubmit={async () => {
                if (feeRequired && !feePaid) {
                  setFeeDialogOpen(true);
                  toast.error("The application fee must be paid before submitting.");
                  return false;
                }
                return true;
              }}
              onSubmitted={(submission?: { id: number | string }) => {
                setSubmittedId(submission?.id);
                setMode("done");
              }}
            />

            {feeRequired && (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <CreditCard className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Application fee — {feeAmount}</p>
                      <p className="text-xs text-muted-foreground">
                        {cfg.fee.basis === "family" ? "One fee per family" : "Per student"} ·{" "}
                        {cfg.fee.refundability}
                      </p>
                    </div>
                  </div>
                  {feePaid ? (
                    <span className="flex items-center gap-1 text-sm text-emerald-700">
                      <CheckCircle2 className="size-4" />
                      Paid
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => setFeeDialogOpen(true)}>
                      Pay {feeAmount}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {mode === "done" && (
          <div className="mx-auto max-w-lg space-y-6 py-10 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-semibold">Application submitted!</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Thank you for applying to {cfg.name}. A confirmation is available in the parent
                portal.
              </p>
            </div>
            {submittedId !== undefined && (
              <p className="text-sm">
                Application ID: <span className="font-mono">{String(submittedId)}</span>
              </p>
            )}
            <div className="flex justify-center gap-2">
              <Button asChild>
                <Link href="/parent">Go to the parent portal</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Mock fee payment dialog. */}
      <Dialog open={feeDialogOpen} onOpenChange={setFeeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay {feeAmount}</DialogTitle>
          </DialogHeader>
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            Demo payment — no card is charged. Any input succeeds.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name on card</Label>
              <Input placeholder="Jordan Smith" />
            </div>
            <div className="space-y-1.5">
              <Label>Card number</Label>
              <Input placeholder="4242 4242 4242 4242" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Expiry</Label>
                <Input placeholder="12/28" />
              </div>
              <div className="space-y-1.5">
                <Label>CVC</Label>
                <Input placeholder="123" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={payFee}>Pay {feeAmount}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
