"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, BookOpen, FileText, Database, AlertTriangle } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import { CATALOG } from "@/lib/ontology/catalog";
import { SectionHeader } from "@/components/console/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SeedPath = "catalog" | "skill" | "manual";
type Step = "path" | "config" | "review";

export default function AddServicePage() {
  const t = useTranslations("addService");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromCatalog = searchParams.get("from");

  const [step, setStep] = useState<Step>(fromCatalog ? "config" : "path");
  const [seedPath, setSeedPath] = useState<SeedPath>(fromCatalog ? "catalog" : "manual");
  const [catalogKey, setCatalogKey] = useState(fromCatalog ?? "");
  const [form, setForm] = useState({
    name: "",
    service_type: "database" as "database" | "api",
    adapter: "",
    host: "",
    port: "",
    database: "",
    user: "",
    password: "",
    domain: "higher-ed",
    llmDiscover: true,
    skipSafety: false,
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function pickCatalog(key: string) {
    const entry = CATALOG.find((c) => c.key === key);
    if (!entry) return;
    setCatalogKey(key);
    setForm((f) => ({
      ...f,
      name: key,
      service_type: entry.type,
      adapter: entry.adapter,
      domain: entry.domain,
      port: String(entry.connection.default_port ?? ""),
    }));
  }

  async function submit() {
    const res = await apiClient.services.add({
      name: form.name,
      service_type: form.service_type,
      adapter: form.adapter,
      host: form.host,
      port: form.port ? Number(form.port) : undefined,
      database: form.database || undefined,
      user: form.user || undefined,
      password: form.password || undefined,
      domain: form.domain,
    });
    if (res.ok) {
      toast.success(t("addedToast", { name: form.name }));
      router.push(`/services/${form.name}`);
    } else {
      toast.error(res.message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/services")} className="px-2">
          <ArrowLeft className="size-4" />
        </Button>
        <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StepDot active={step === "path"} done={step !== "path"} label="1" />
        <span className={step === "path" ? "font-medium text-foreground" : ""}>
          {t("pathTitle")}
        </span>
        <span className="h-px w-8 bg-border" />
        <StepDot active={step === "config"} done={step === "review"} label="2" />
        <span className={step === "config" ? "font-medium text-foreground" : ""}>
          {t("configTitle")}
        </span>
        <span className="h-px w-8 bg-border" />
        <StepDot active={step === "review"} done={false} label="3" />
        <span className={step === "review" ? "font-medium text-foreground" : ""}>
          {t("reviewTitle")}
        </span>
      </div>

      {step === "path" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <PathCard
            active={seedPath === "catalog"}
            onClick={() => setSeedPath("catalog")}
            icon={BookOpen}
            title={t("pathCatalog")}
            hint={t("pathCatalogHint")}
          />
          <PathCard
            active={seedPath === "skill"}
            onClick={() => setSeedPath("skill")}
            icon={FileText}
            title={t("pathSkill")}
            hint={t("pathSkillHint")}
          />
          <PathCard
            active={seedPath === "manual"}
            onClick={() => setSeedPath("manual")}
            icon={Database}
            title={t("pathManual")}
            hint={t("pathManualHint")}
          />
          <div className="sm:col-span-3 flex justify-end">
            <Button onClick={() => setStep("config")}>
              {t("continue")}
              <ArrowRight className="ml-2 size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {step === "config" && (
        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            {seedPath === "catalog" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("catalogKey")}</Label>
                <Select value={catalogKey} onValueChange={(v) => pickCatalog(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("pickCatalog")} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATALOG.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        <span className="font-mono">{c.key}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{c.display_name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("catalogKeyHint")}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("name")} hint={t("nameHint")}>
                <Input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("serviceType")}>
                <Select
                  value={form.service_type}
                  onValueChange={(v) => update("service_type", v as "database" | "api")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="database">database</SelectItem>
                    <SelectItem value="api">api</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("host")}>
                <Input
                  value={form.host}
                  onChange={(e) => update("host", e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("port")}>
                <Input
                  value={form.port}
                  onChange={(e) => update("port", e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("database")}>
                <Input
                  value={form.database}
                  onChange={(e) => update("database", e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("user")}>
                <Input
                  value={form.user}
                  onChange={(e) => update("user", e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field label={t("password")} hint={t("passwordHint")}>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  className="font-mono"
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="llm"
                checked={form.llmDiscover}
                onCheckedChange={(v) => update("llmDiscover", v === true)}
              />
              <Label htmlFor="llm" className="text-sm font-normal">
                {t("llmDiscover")}
              </Label>
              <span className="text-xs text-muted-foreground">· {t("llmDiscoverHint")}</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("path")}>
                {tc("back")}
              </Button>
              <Button onClick={() => setStep("review")}>
                {t("continue")}
                <ArrowRight className="ml-2 size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("reviewHint")}</p>
          <Card>
            <CardContent className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-2">
              <ReviewRow label={t("name")} value={<span className="font-mono">{form.name}</span>} />
              <ReviewRow
                label={t("serviceType")}
                value={<span className="font-mono">{form.service_type}</span>}
              />
              <ReviewRow
                label={t("host")}
                value={<span className="font-mono">{form.host || "—"}</span>}
              />
              <ReviewRow
                label={t("port")}
                value={<span className="font-mono">{form.port || "—"}</span>}
              />
              <ReviewRow
                label={t("database")}
                value={<span className="font-mono">{form.database || "—"}</span>}
              />
              <ReviewRow
                label={t("user")}
                value={<span className="font-mono">{form.user || "—"}</span>}
              />
            </CardContent>
          </Card>
          {form.skipSafety && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>{t("skipSafety")}</AlertTitle>
              <AlertDescription>{t("skipSafetyWarning")}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep("config")}>
              {tc("back")}
            </Button>
            <Button onClick={submit}>{t("addAndDiscover")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex size-5 items-center justify-center rounded-full border text-xs",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : done
            ? "border-emerald-200 bg-emerald-100 text-emerald-700"
            : "border-border text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function PathCard({
  active,
  onClick,
  icon: Icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BookOpen;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
        active ? "border-primary bg-accent" : "border-border hover:bg-muted/40",
      )}
    >
      <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
