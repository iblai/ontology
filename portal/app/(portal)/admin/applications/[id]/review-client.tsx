"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Circle, EyeOff, Send } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  addInternalNote,
  addInterviewNote,
  changeStatus,
  COMMUNICATION_TEMPLATES,
  getApplication,
  recordDecision,
  recordInterviewOutcome,
  requestInformation,
  sendCommunication,
  setInterviewRequired,
  waiveFee,
  waiveInterview,
} from "@/lib/api";
import { renderTemplate, type CommunicationTemplateId } from "@/lib/api/templates";
import type { ApplicationStatus, Interview } from "@/lib/types";
import { TRANSITIONS } from "@/lib/status";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate, fmtDateTime, money } from "@/lib/format";

type DecisionKind = "acceptance" | "declination" | "waitlist";

export function ReviewWorkspace({ id }: { id: string }) {
  const t = useTranslations("review");
  const ts = useTranslations("status");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin"]);
  const { data: app, reload } = useLoad(async () => {
    if (!user) return undefined;
    try {
      return await getApplication(id);
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    }
  }, [user, id]);

  // dialog state
  const [statusTo, setStatusTo] = useState<ApplicationStatus | "">("");
  const [statusNote, setStatusNote] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoItems, setInfoItems] = useState("");
  const [decision, setDecision] = useState<DecisionKind | null>(null);
  const [decisionStudents, setDecisionStudents] = useState<string[]>([]);
  const [waiveFeeOpen, setWaiveFeeOpen] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [interviewNote, setInterviewNote] = useState("");
  const [template, setTemplate] = useState<CommunicationTemplateId | "">("");

  if (!user || !app) return null;
  const cfg = getSchoolConfig(app.schoolSlug)!;
  const parent = app.guardians[0];

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      toast.success(okMsg);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const transitions = TRANSITIONS[app.status] ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {parent ? `${parent.lastName} Family` : app.id}
            <StatusBadge status={app.status} />
          </span>
        }
        description={`${app.id} · ${cfg.name} · ${app.programYear}${
          app.submittedAt ? ` · ${t("submitted", { date: fmtDate(app.submittedAt) })}` : ""
        }`}
        actions={
          <>
            <Select
              value=""
              onValueChange={(v) => {
                setStatusTo(v as ApplicationStatus);
                setStatusNote("");
              }}
            >
              <SelectTrigger className="h-9 w-44" disabled={transitions.length === 0}>
                <SelectValue placeholder={t("changeStatus")} />
              </SelectTrigger>
              <SelectContent>
                {transitions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ts(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setInfoOpen(true)}>
              {t("requestInfo")}
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                setDecision("acceptance");
                setDecisionStudents(app.students.map((s) => s.id));
              }}
            >
              {t("accept")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDecision("waitlist");
                setDecisionStudents(app.students.map((s) => s.id));
              }}
            >
              {t("waitlist")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setDecision("declination");
                setDecisionStudents(app.students.map((s) => s.id));
              }}
            >
              {t("decline")}
            </Button>
          </>
        }
      />

      <Tabs defaultValue="household">
        <TabsList className="flex-wrap">
          <TabsTrigger value="household">{t("tabHousehold")}</TabsTrigger>
          <TabsTrigger value="students">{t("tabStudents")}</TabsTrigger>
          <TabsTrigger value="documents">{t("tabDocuments")}</TabsTrigger>
          {app.interview && <TabsTrigger value="interview">{t("tabInterview")}</TabsTrigger>}
          <TabsTrigger value="notes">{t("tabNotes")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
          <TabsTrigger value="communications">{t("tabCommunications")}</TabsTrigger>
        </TabsList>

        {/* Household */}
        <TabsContent value="household">
          <Card>
            <CardContent className="grid gap-6 pt-6 sm:grid-cols-2">
              {app.guardians.map((g, i) => (
                <div key={i} className="space-y-1 text-sm">
                  <p className="font-semibold">
                    {t("guardianN", { n: i + 1 })} — {g.relationship}
                  </p>
                  <p>
                    {g.firstName} {g.lastName}
                  </p>
                  <p className="text-muted-foreground">
                    {g.email} · {g.phone}
                  </p>
                  <p className="text-muted-foreground">
                    {g.address.street}, {g.address.city}, {g.address.state} {g.address.zip}
                  </p>
                </div>
              ))}
              <div className="space-y-3 sm:col-span-2">
                {Object.entries(app.familyAnswers)
                  .filter(([, v]) => v)
                  .map(([k, v]) => {
                    const q = cfg.familyQuestions.find((x) => x.id === k);
                    return (
                      <div key={k} className="text-sm">
                        <p className="text-muted-foreground">{q?.label ?? k}</p>
                        <p className="whitespace-pre-wrap">{v}</p>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Students */}
        <TabsContent value="students">
          <Card>
            <CardContent className="pt-6">
              <Accordion type="multiple" defaultValue={app.students.map((s) => s.id)}>
                {app.students.map((s) => {
                  const studentTransitions = TRANSITIONS[s.status] ?? [];
                  return (
                    <AccordionItem key={s.id} value={s.id}>
                      <AccordionTrigger className="text-sm">
                        <span className="flex flex-wrap items-center gap-2">
                          {s.legalFirstName} {s.legalLastName}
                          <span className="text-xs text-muted-foreground">
                            {t("gradeShort", { grade: s.gradeLevel })} ·{" "}
                            {cfg.programs.find((p) => p.id === s.program)?.label ?? s.program}
                          </span>
                          <StatusBadge status={s.status} />
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t("studentStatus")}
                          </span>
                          <Select
                            value=""
                            onValueChange={(v) =>
                              act(
                                () =>
                                  changeStatus(app.id, v as ApplicationStatus, { studentId: s.id }),
                                t("statusChanged"),
                              )
                            }
                          >
                            <SelectTrigger
                              className="h-8 w-44"
                              disabled={studentTransitions.length === 0}
                            >
                              <SelectValue placeholder={t("changeStatus")} />
                            </SelectTrigger>
                            <SelectContent>
                              {studentTransitions.map((st) => (
                                <SelectItem key={st} value={st}>
                                  {ts(st)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-muted-foreground">
                          {t("dob")}: {fmtDate(s.dateOfBirth)} · {s.gender}
                          {s.email ? ` · ${s.email}` : ""}
                          {s.individualCourse ? ` · ${s.individualCourse}` : ""}
                        </p>
                        {s.supportInfo && (
                          <div>
                            <p className="text-muted-foreground">{t("supportInfo")}</p>
                            <p className="whitespace-pre-wrap">{s.supportInfo}</p>
                          </div>
                        )}
                        {Object.entries(s.academicBackground)
                          .filter(([, v]) => v)
                          .map(([k, v]) => (
                            <div key={k}>
                              <p className="text-muted-foreground">
                                {cfg.academicBackgroundQuestions.find((q) => q.id === k)?.label ??
                                  k}
                              </p>
                              <p className="whitespace-pre-wrap">{v}</p>
                            </div>
                          ))}
                        {s.studentResponses &&
                          Object.entries(s.studentResponses)
                            .filter(([, v]) => v)
                            .map(([k, v]) => (
                              <div key={k}>
                                <p className="text-muted-foreground">
                                  {cfg.studentResponseQuestions.find((q) => q.id === k)?.label ?? k}
                                </p>
                                <p className="whitespace-pre-wrap">{v}</p>
                              </div>
                            ))}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents & agreements */}
        <TabsContent value="documents">
          <Card>
            <CardContent className="space-y-5 pt-6 text-sm">
              <div>
                <p className="mb-2 font-semibold">{t("feeTitle")}</p>
                <div className="flex items-center gap-3">
                  <span>{money(app.fee.amountCents)}</span>
                  <StatusBadgeLike ok={app.fee.status !== "unpaid"}>
                    {app.fee.status === "paid"
                      ? t("feePaid", { date: fmtDate(app.fee.paidAt) })
                      : app.fee.status === "waived"
                        ? t("feeWaived")
                        : t("feeUnpaid")}
                  </StatusBadgeLike>
                  {app.fee.status === "unpaid" && (
                    <Button variant="outline" size="sm" onClick={() => setWaiveFeeOpen(true)}>
                      {t("waiveFee")}
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 font-semibold">{t("documentsTitle")}</p>
                {app.documents.length === 0 && (
                  <p className="text-muted-foreground">{t("noDocuments")}</p>
                )}
                <ul className="space-y-1">
                  {app.documents.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2">
                      <span>{d.name}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(d.uploadedAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 font-semibold">{t("agreementsTitle")}</p>
                <ul className="space-y-1.5">
                  {app.acknowledgments.map((a) => (
                    <li key={a.id} className="flex items-start gap-2">
                      {a.checked ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>
                        {a.label}
                        {a.handbookVersion && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({a.handbookVersion})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 font-semibold">{t("signaturesTitle")}</p>
                {app.signatures.length === 0 && (
                  <p className="text-muted-foreground">{t("noSignatures")}</p>
                )}
                <ul className="space-y-1">
                  {app.signatures.map((s, i) => (
                    <li key={i}>
                      <span className="font-serif italic">{s.signature}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.signerName} · {t(`sigRole_${s.role}`)} · {fmtDate(s.signedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {app.medicalRelease && (
                <div>
                  <p className="mb-2 font-semibold">{t("medicalTitle")}</p>
                  <p className="text-muted-foreground">
                    {app.medicalRelease.emergencyContactName} (
                    {app.medicalRelease.emergencyContactRelationship}) ·{" "}
                    {app.medicalRelease.emergencyContactPhone}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("medicalWindow", {
                      from: fmtDate(app.medicalRelease.effectiveFrom),
                      to: fmtDate(app.medicalRelease.effectiveTo),
                    })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Interview */}
        {app.interview && (
          <TabsContent value="interview">
            <Card>
              <CardContent className="space-y-4 pt-6 text-sm">
                <InternalBanner text={t("internalOnly")} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t("interviewRequired")}:</span>
                  <span>{app.interview.required ? t("yes") : t("no")}</span>
                  {app.interview.waivedBy && (
                    <span className="text-xs text-muted-foreground">
                      {t("waivedBy", { name: app.interview.waivedBy })}
                    </span>
                  )}
                  {app.interview.outcome && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {t(`outcome_${app.interview.outcome}`)}
                      {app.interview.completedAt ? ` · ${fmtDate(app.interview.completedAt)}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["proceed", "request_info", "decline", "waitlist"] as const).map((o) => (
                    <Button
                      key={o}
                      variant={o === "proceed" ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        act(() => recordInterviewOutcome(app.id, o), t("outcomeRecorded"))
                      }
                    >
                      {t(`outcome_${o}`)}
                    </Button>
                  ))}
                  {!app.interview.waivedBy && app.interview.required && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => act(() => waiveInterview(app.id), t("interviewWaived"))}
                    >
                      {t("waiveInterview")}
                    </Button>
                  )}
                  {!app.interview.required && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        act(() => setInterviewRequired(app.id, true), t("interviewSet"))
                      }
                    >
                      {t("markInterviewRequired")}
                    </Button>
                  )}
                </div>
                <NoteList notes={app.interview.notes} />
                <div className="flex gap-2">
                  <Textarea
                    rows={2}
                    value={interviewNote}
                    onChange={(e) => setInterviewNote(e.target.value)}
                    placeholder={t("interviewNotePlaceholder")}
                  />
                  <Button
                    size="sm"
                    disabled={!interviewNote.trim()}
                    onClick={() =>
                      act(async () => {
                        await addInterviewNote(app.id, interviewNote.trim());
                        setInterviewNote("");
                      }, t("noteAdded"))
                    }
                  >
                    {t("addNote")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Internal notes */}
        <TabsContent value="notes">
          <Card>
            <CardContent className="space-y-4 pt-6 text-sm">
              <InternalBanner text={t("internalOnly")} />
              <NoteList notes={app.internalNotes} />
              <div className="flex gap-2">
                <Textarea
                  rows={2}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={t("notePlaceholder")}
                />
                <Button
                  size="sm"
                  disabled={!noteText.trim()}
                  onClick={() =>
                    act(async () => {
                      await addInternalNote(app.id, noteText.trim());
                      setNoteText("");
                    }, t("noteAdded"))
                  }
                >
                  {t("addNote")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("histWhen")}</TableHead>
                    <TableHead>{t("histChange")}</TableHead>
                    <TableHead>{t("histBy")}</TableHead>
                    <TableHead>{t("histNote")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...app.history].reverse().map((h, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {fmtDateTime(h.at)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          {ts(h.from)} → <StatusBadge status={h.to} />
                          {h.studentId && (
                            <span className="text-muted-foreground">
                              ({app.students.find((s) => s.id === h.studentId)?.legalFirstName})
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{h.by}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {h.note ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Communications */}
        <TabsContent value="communications">
          <Card>
            <CardContent className="space-y-4 pt-6 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={template}
                  onValueChange={(v) => setTemplate(v as CommunicationTemplateId)}
                >
                  <SelectTrigger className="h-9 w-64">
                    <SelectValue placeholder={t("pickTemplate")} />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMUNICATION_TEMPLATES.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!template}
                  onClick={() =>
                    act(async () => {
                      await sendCommunication(app.id, template as CommunicationTemplateId);
                      setTemplate("");
                    }, t("messageSent"))
                  }
                >
                  <Send className="size-3.5" />
                  {t("send")}
                </Button>
              </div>
              {template && (
                <p className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {renderTemplate(
                    COMMUNICATION_TEMPLATES.find((x) => x.id === template)!.body,
                    app,
                  )}
                </p>
              )}
              {app.communications.length === 0 ? (
                <p className="text-muted-foreground">{t("noMessages")}</p>
              ) : (
                <ul className="space-y-2">
                  {[...app.communications].reverse().map((c) => (
                    <li key={c.id} className="rounded-lg border p-3">
                      <p className="font-medium">{c.subject}</p>
                      <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
                        {c.body}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {c.sentBy} · {fmtDateTime(c.sentAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Status change dialog */}
      <Dialog open={Boolean(statusTo)} onOpenChange={(o) => !o && setStatusTo("")}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusTo && t("statusDialogTitle", { status: ts(statusTo) })}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            rows={2}
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            placeholder={t("statusNotePlaceholder")}
          />
          <DialogFooter>
            <Button
              onClick={() =>
                act(async () => {
                  await changeStatus(app.id, statusTo as ApplicationStatus, {
                    note: statusNote.trim() || undefined,
                  });
                  setStatusTo("");
                }, t("statusChanged"))
              }
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request info dialog */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("requestInfoTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={3}
            value={infoItems}
            onChange={(e) => setInfoItems(e.target.value)}
            placeholder={t("requestInfoPlaceholder")}
          />
          <DialogFooter>
            <Button
              disabled={!infoItems.trim()}
              onClick={() =>
                act(async () => {
                  await requestInformation(app.id, infoItems.trim());
                  setInfoOpen(false);
                  setInfoItems("");
                }, t("infoRequested"))
              }
            >
              {t("sendRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waive fee dialog */}
      <Dialog open={waiveFeeOpen} onOpenChange={setWaiveFeeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("waiveFeeTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={2}
            value={waiveReason}
            onChange={(e) => setWaiveReason(e.target.value)}
            placeholder={t("waiveFeeReason")}
          />
          <DialogFooter>
            <Button
              disabled={!waiveReason.trim()}
              onClick={() =>
                act(async () => {
                  await waiveFee(app.id, waiveReason.trim());
                  setWaiveFeeOpen(false);
                  setWaiveReason("");
                }, t("feeWaivedToast"))
              }
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decision dialog — school template preview. PDF §2.4. */}
      <Dialog open={Boolean(decision)} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{decision && t(`decisionTitle_${decision}`)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("decisionStudents")}</p>
            {app.students.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={decisionStudents.includes(s.id)}
                  onCheckedChange={(v) =>
                    setDecisionStudents((prev) =>
                      v === true ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                    )
                  }
                />
                {s.legalFirstName} {s.legalLastName}
                <StatusBadge status={s.status} />
              </label>
            ))}
            {decision && (
              <div>
                <p className="mb-1 text-sm font-medium">{t("decisionPreview")}</p>
                <p className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {renderTemplate(cfg.decisionTemplates[decision], app, decisionStudents)}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={decisionStudents.length === 0}
              onClick={() =>
                act(async () => {
                  await recordDecision(app.id, decisionStudents, decision as DecisionKind);
                  setDecision(null);
                }, t("decisionRecorded"))
              }
            >
              {t("confirmAndNotify")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InternalBanner({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
      <EyeOff className="size-3.5" />
      {text}
    </p>
  );
}

function NoteList({ notes }: { notes: Interview["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-2">
      {[...notes].reverse().map((n) => (
        <li key={n.id} className="rounded-lg border p-3">
          <p className="whitespace-pre-wrap">{n.body}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {n.author} · {fmtDateTime(n.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function StatusBadgeLike({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      {children}
    </span>
  );
}
