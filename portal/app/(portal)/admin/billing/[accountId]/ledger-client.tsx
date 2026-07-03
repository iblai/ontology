"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import {
  accountBalance,
  addLedgerEntry,
  getApplication,
  listAccounts,
  listInvoices,
  makePayment,
  setHold,
} from "@/lib/api";
import type { Application, ChargeType, FundingSource, LedgerEntry } from "@/lib/types";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate, fmtDateTime, money } from "@/lib/format";

const CHARGE_TYPES: ChargeType[] = [
  "application_fee",
  "registration_fee",
  "tuition",
  "curriculum",
  "supply",
  "facility",
  "lunch",
  "field_trip",
  "activity",
  "technology",
  "late_fee",
  "other",
];
const FUNDING: FundingSource[] = [
  "parent",
  "esa",
  "sgo",
  "scholarship",
  "grant",
  "third_party",
  "credit",
];
const ENTRY_KINDS: LedgerEntry["kind"][] = [
  "charge",
  "payment",
  "credit",
  "refund",
  "waiver",
  "adjustment",
];

// Family ledger + finance controls. PDF §7: every adjustment logs name/date/amount.
export function LedgerClient({ accountId }: { accountId: string }) {
  const t = useTranslations("ledger");
  const tf = useTranslations("funding");
  const tc = useTranslations("chargeTypes");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin", "finance_admin"]);

  const { data, reload } = useLoad(async () => {
    if (!user) return undefined;
    const accounts = await listAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return undefined;
    const [invoices, app] = await Promise.all([
      listInvoices(account.id),
      getApplication(account.applicationId).catch(() => null),
    ]);
    return { account, invoices, app: app as Application | null };
  }, [user, accountId]);

  const [entryOpen, setEntryOpen] = useState(false);
  const [kind, setKind] = useState<LedgerEntry["kind"]>("charge");
  const [chargeType, setChargeType] = useState<ChargeType>("other");
  const [funding, setFunding] = useState<FundingSource>("parent");
  const [studentId, setStudentId] = useState<string>("none");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");

  if (!user || !data) return null;
  const { account, invoices, app } = data;
  const balance = accountBalance(account);

  const addEntry = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!isFinite(cents) || cents <= 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    // Charges increase the balance; payments/credits/refunds/waivers reduce it.
    const signed = kind === "charge" ? cents : -cents;
    await addLedgerEntry(account.id, {
      kind,
      chargeType: kind === "charge" || kind === "waiver" ? chargeType : undefined,
      fundingSource: kind === "payment" || kind === "credit" ? funding : undefined,
      studentId: studentId === "none" ? undefined : studentId,
      amountCents: signed,
      memo: memo.trim() || undefined,
    });
    setEntryOpen(false);
    setAmount("");
    setMemo("");
    toast.success(t("entryAdded"));
    await reload();
  };

  const toggleHold = async () => {
    if (account.hold) {
      await setHold(account.id, false);
      toast.success(t("holdReleased"));
      await reload();
    } else {
      setHoldOpen(true);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={account.familyName}
        description={`${account.applicationId} · ${t("balance")}: ${money(balance)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setEntryOpen(true)}>
              {t("addEntry")}
            </Button>
            <Button
              variant={account.hold ? "destructive" : "outline"}
              size="sm"
              onClick={toggleHold}
            >
              {account.hold ? t("releaseHold") : t("placeHold")}
            </Button>
          </>
        }
      />

      {account.hold && (
        <Alert className="mb-4 border-red-200 bg-red-50 text-red-900">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t("holdActive")}</AlertTitle>
          <AlertDescription>
            {account.hold.reason} — {account.hold.placedBy}, {fmtDate(account.hold.placedAt)}
          </AlertDescription>
        </Alert>
      )}

      {account.plan && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">
              {t("planTitle", { plan: t(`plan_${account.plan.kind}`) })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1 text-sm sm:grid-cols-2">
              {account.plan.installments.map((inst) => {
                const inv = invoices.find((i) => i.id === inst.invoiceId);
                return (
                  <div key={inst.dueDate} className="flex justify-between gap-2">
                    <span>{fmtDate(inst.dueDate)}</span>
                    <span className="flex items-center gap-2">
                      {money(inst.amountCents)}
                      {inv && (
                        <span
                          className={`text-xs ${
                            inv.status === "paid"
                              ? "text-emerald-700"
                              : inv.status === "overdue"
                                ? "text-red-700"
                                : "text-amber-700"
                          }`}
                        >
                          {t(`invoice_${inv.status}`)}
                        </span>
                      )}
                      {inv && inv.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={async () => {
                            await makePayment(account.id, inv.id, "parent");
                            toast.success(t("offlinePaymentRecorded"));
                            await reload();
                          }}
                        >
                          {t("recordPayment")}
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("ledgerTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colWhen")}</TableHead>
                <TableHead>{t("colKind")}</TableHead>
                <TableHead>{t("colMemo")}</TableHead>
                <TableHead>{t("colStudent")}</TableHead>
                <TableHead>{t("colFunding")}</TableHead>
                <TableHead>{t("colBy")}</TableHead>
                <TableHead className="text-right">{t("colAmount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...account.ledger].reverse().map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(e.at)}</TableCell>
                  <TableCell className="text-xs">
                    {t(`kind_${e.kind}`)}
                    {e.chargeType ? ` · ${tc(e.chargeType)}` : ""}
                  </TableCell>
                  <TableCell className="text-xs">{e.memo ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {e.studentId
                      ? (app?.students.find((s) => s.id === e.studentId)?.legalFirstName ??
                        e.studentId)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.fundingSource ? tf(e.fundingSource) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">{e.by}</TableCell>
                  <TableCell
                    className={`text-right ${e.amountCents < 0 ? "text-emerald-700" : ""}`}
                  >
                    {money(e.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add ledger entry */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addEntry")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("colKind")}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as LedgerEntry["kind"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTRY_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kind_${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("amountUsd")}</Label>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </div>
            </div>
            {(kind === "charge" || kind === "waiver") && (
              <div className="space-y-1.5">
                <Label>{t("chargeType")}</Label>
                <Select value={chargeType} onValueChange={(v) => setChargeType(v as ChargeType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARGE_TYPES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {tc(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(kind === "payment" || kind === "credit") && (
              <div className="space-y-1.5">
                <Label>{t("colFunding")}</Label>
                <Select value={funding} onValueChange={(v) => setFunding(v as FundingSource)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNDING.map((f) => (
                      <SelectItem key={f} value={f}>
                        {tf(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {app && (
              <div className="space-y-1.5">
                <Label>{t("colStudent")}</Label>
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("familyLevel")}</SelectItem>
                    {app.students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.legalFirstName} {s.legalLastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("colMemo")}</Label>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={addEntry}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Place hold */}
      <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("placeHold")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("holdReason")}</Label>
            <Input value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              disabled={!holdReason.trim()}
              onClick={async () => {
                await setHold(account.id, true, holdReason.trim());
                setHoldOpen(false);
                setHoldReason("");
                toast.success(t("holdPlaced"));
                await reload();
              }}
            >
              {t("placeHold")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
