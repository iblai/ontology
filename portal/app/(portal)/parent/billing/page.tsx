"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { accountBalance, listAccountsForParent, listInvoices, makePayment } from "@/lib/api";
import type { FundingSource, Invoice } from "@/lib/types";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate, money } from "@/lib/format";

const PARENT_FUNDING: FundingSource[] = ["parent", "esa", "sgo", "scholarship"];

export default function ParentBillingPage() {
  const t = useTranslations("parentBilling");
  const tf = useTranslations("funding");
  const user = useRequireRole(["parent"]);
  const [payInvoice, setPayInvoice] = useState<{ accountId: string; invoice: Invoice } | null>(
    null,
  );
  const [source, setSource] = useState<FundingSource>("parent");

  const { data, reload } = useLoad(async () => {
    if (!user) return undefined;
    const accounts = await listAccountsForParent(user.email!);
    const invoices = await Promise.all(accounts.map((a) => listInvoices(a.id)));
    return accounts.map((account, i) => ({ account, invoices: invoices[i] }));
  }, [user]);

  if (!user || !data) return null;

  const doPay = async () => {
    if (!payInvoice) return;
    await makePayment(payInvoice.accountId, payInvoice.invoice.id, source);
    setPayInvoice(null);
    toast.success(t("paymentDone"));
    await reload();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {data.length === 0 && (
        <EmptyState title={t("noAccounts")} description={t("noAccountsHint")} />
      )}

      <div className="space-y-6">
        {data.map(({ account, invoices }) => {
          const balance = accountBalance(account);
          const dueInvoices = invoices.filter((i) => i.status !== "paid");
          return (
            <Card key={account.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {account.familyName} · {account.applicationId}
                </CardTitle>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{t("balance")}</p>
                  <p className="text-lg font-semibold">{money(balance)}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {account.hold && (
                  <Alert className="border-red-200 bg-red-50 text-red-900">
                    <AlertTriangle className="size-4" />
                    <AlertTitle>{t("holdTitle")}</AlertTitle>
                    <AlertDescription>{account.hold.reason}</AlertDescription>
                  </Alert>
                )}

                {account.plan ? (
                  <p className="text-sm text-muted-foreground">
                    {t("planActive", { plan: t(`plan_${account.plan.kind}`) })}
                  </p>
                ) : (
                  <Alert className="border-blue-200 bg-blue-50 text-blue-900">
                    <AlertDescription>
                      {t("noPlanYet")}{" "}
                      <Link href="/parent/billing/plans" className="underline">
                        {t("choosePlan")}
                      </Link>
                    </AlertDescription>
                  </Alert>
                )}

                {invoices.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t("invoices")}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("dueDate")}</TableHead>
                          <TableHead>{t("amount")}</TableHead>
                          <TableHead>{t("status")}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices
                          .slice()
                          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                          .map((inv) => (
                            <TableRow key={inv.id}>
                              <TableCell>{fmtDate(inv.dueDate)}</TableCell>
                              <TableCell>{money(inv.amountCents)}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={
                                    inv.status === "paid"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : inv.status === "overdue"
                                        ? "bg-red-50 text-red-700"
                                        : "bg-amber-50 text-amber-700"
                                  }
                                >
                                  {t(`invoice_${inv.status}`)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {inv.status !== "paid" && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      setPayInvoice({ accountId: account.id, invoice: inv })
                                    }
                                  >
                                    {t("pay")}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                    {dueInvoices.length === 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">{t("allPaid")}</p>
                    )}
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t("activity")}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("date")}</TableHead>
                        <TableHead>{t("description")}</TableHead>
                        <TableHead>{t("funding")}</TableHead>
                        <TableHead className="text-right">{t("amount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...account.ledger].reverse().map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap">{fmtDate(e.at)}</TableCell>
                          <TableCell>{e.memo ?? e.kind}</TableCell>
                          <TableCell>{e.fundingSource ? tf(e.fundingSource) : "—"}</TableCell>
                          <TableCell
                            className={`text-right ${e.amountCents < 0 ? "text-emerald-700" : ""}`}
                          >
                            {money(e.amountCents)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(payInvoice)} onOpenChange={(o) => !o && setPayInvoice(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("payDialogTitle", {
                amount: payInvoice ? money(payInvoice.invoice.amountCents) : "",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{t("fundingSource")}</p>
            <Select value={source} onValueChange={(v) => setSource(v as FundingSource)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARENT_FUNDING.map((f) => (
                  <SelectItem key={f} value={f}>
                    {tf(f)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="pt-1 text-xs text-muted-foreground">{t("mockNotice")}</p>
          </div>
          <DialogFooter>
            <Button onClick={doPay}>{t("confirmPay")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
