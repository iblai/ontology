"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { SyncSchedule } from "@/lib/ontology/types";
import { Field, FormDialog } from "@/components/console/form-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MODES = ["full", "delta", "event"] as const;
const schema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    cron: z.string().regex(/^(\S+(\s+\S+){4})?$/),
    source: z.string().min(1),
    tool: z.string().min(1),
    mode: z.enum(MODES),
    description: z.string(),
    enabled: z.boolean(),
  })
  .refine((v) => v.mode === "event" || v.cron.length > 0, { path: ["cron"] });
type Values = z.infer<typeof schema>;

export function ScheduleDialog({
  open,
  onOpenChange,
  initial,
  sources,
  tools,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: SyncSchedule;
  sources: string[];
  tools: string[];
  onSaved: () => void;
}) {
  const t = useTranslations("sync");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: initial?.name ?? "",
      cron: initial?.cron ?? "",
      source: initial?.source ?? "",
      tool: initial?.tool ?? "",
      mode: initial?.mode ?? "full",
      description: initial?.description ?? "",
      enabled: initial?.enabled ?? true,
    },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setSaving(true);
    try {
      const r = await apiClient.sync.saveSchedule(v);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t("editSchedule") : t("newSchedule")}
      onSubmit={submit}
      saving={saving}
    >
      <Field label={t("name")} htmlFor="sched-name" error={errors.name && t("nameHint")}>
        <Input id="sched-name" {...form.register("name")} disabled={Boolean(initial)} />
      </Field>
      <Field
        label={t("cron")}
        htmlFor="sched-cron"
        error={errors.cron && t("cronHint")}
        hint={t("cronHint")}
      >
        <Input id="sched-cron" {...form.register("cron")} />
      </Field>
      <Field label={t("source")} htmlFor="sched-source" error={errors.source && tc("required")}>
        <Input id="sched-source" list="sched-sources" {...form.register("source")} />
        <datalist id="sched-sources">
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </datalist>
      </Field>
      <Field label={t("tool")} htmlFor="sched-tool" error={errors.tool && tc("required")}>
        <Input id="sched-tool" list="sched-tools" {...form.register("tool")} />
        <datalist id="sched-tools">
          {tools.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </datalist>
      </Field>
      <Field label={t("mode")}>
        <Controller
          control={form.control}
          name="mode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <Field label={t("description")} htmlFor="sched-description">
        <Input id="sched-description" {...form.register("description")} />
      </Field>
      <Controller
        control={form.control}
        name="enabled"
        render={({ field }) => (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={field.value} onCheckedChange={(on) => field.onChange(on === true)} />
            {t("enabled")}
          </label>
        )}
      />
    </FormDialog>
  );
}
