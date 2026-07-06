"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import {
  accountBalance,
  listAccountsForParent,
  planInstallmentsFor,
  selectPaymentPlan,
} from "@/lib/api";
import type { PaymentPlanKind } from "@/lib/types";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate, money } from "@/lib/format";

// Payment plan selection for accepted families. PDF §7.1.
export default function PlanSelectionPage() {
  const t = useTranslations("plans");
  const user = useRequireRole(["parent"]);
  const router = useRouter();
  const [choice, setChoice] = useState<PaymentPlanKind | "">("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: accounts } = useLoad(async () => {
    if (!user) return undefined;
    return listAccountsForParent(user.email!);
  }, [user]);

  if (!user || !accounts) return null;
  const account = accounts.find((a) => !a.plan);

  if (!account) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t("title")} />
        <EmptyState title={t("nothingToDo")} description={t("nothingToDoHint")} />
      </div>
    );
  }

  const cfg = getSchoolConfig(account.schoolSlug)!;
  const balance = accountBalance(account);
  const charges = account.ledger.filter((e) => e.kind === "charge");
  const credits = account.ledger.filter((e) => e.kind !== "charge");

  const activate = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      await selectPaymentPlan(account.id, choice);
      toast.success(t("activated"));
      router.push("/parent/billing");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle", { school: cfg.name })} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("chargesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {charges.map((e) => (
            <div key={e.id} className="flex justify-between">
              <span>{e.memo}</span>
              <span>{money(e.amountCents)}</span>
            </div>
          ))}
          {credits.map((e) => (
            <div key={e.id} className="flex justify-between text-emerald-700">
              <span>{e.memo}</span>
              <span>{money(e.amountCents)}</span>
            </div>
          ))}
          <Separator className="my-2" />
          <div className="flex justify-between font-semibold">
            <span>{t("annualObligation")}</span>
            <span>{money(balance)}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("optionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={choice}
            onValueChange={(v) => setChoice(v as PaymentPlanKind)}
            className="space-y-2"
          >
            {cfg.planKinds.map((kind) => {
              const installments = planInstallmentsFor(balance, kind);
              return (
                <label
                  key={kind}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem value={kind} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t(`plan_${kind}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("installmentSummary", {
                        n: installments.length,
                        amount: money(installments[installments.length - 1].amountCents),
                        first: fmtDate(installments[0].dueDate),
                      })}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>

          {choice && (
            <div className="mt-4 rounded-lg bg-muted/40 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                {t("scheduleTitle")}
              </p>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {planInstallmentsFor(balance, choice).map((inst) => (
                  <li key={inst.dueDate} className="flex justify-between">
                    <span>{fmtDate(inst.dueDate)}</span>
                    <span>{money(inst.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="mt-4 flex items-start gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              className="mt-0.5"
            />
            {t("policiesAck")}
          </label>

          <Button className="mt-4" disabled={!choice || !acknowledged || saving} onClick={activate}>
            {t("activate")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
