"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { Role } from "@/lib/ontology/types";
import { Field, FormDialog, lines } from "@/components/console/form-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const schema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  display_name: z.string().min(1),
  mcp_toolsets: z.array(z.string()),
  memory_paths: z.string(),
  cache_tables: z.string(),
  agents: z.string(),
  admin_dashboard: z.boolean(),
  max_records_per_query: z.string().regex(/^\d*$/),
  max_export_rows: z.string().regex(/^\d*$/),
});
type Values = z.infer<typeof schema>;

function toValues(role?: Role): Values {
  return {
    name: role?.name ?? "",
    display_name: role?.display_name ?? "",
    mcp_toolsets: role?.mcp_toolsets ?? [],
    memory_paths: (role?.memory_paths ?? []).join("\n"),
    cache_tables: (role?.cache_tables ?? []).join("\n"),
    agents: (role?.agents ?? []).join("\n"),
    admin_dashboard: role?.admin_dashboard ?? false,
    max_records_per_query: String(role?.concurrency_limits?.max_records_per_query ?? ""),
    max_export_rows: String(role?.concurrency_limits?.max_export_rows ?? ""),
  };
}

export function RoleDialog({
  open,
  onOpenChange,
  initial,
  toolsets,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Role;
  toolsets: string[];
  /** Called with the role as it was saved. */
  onSaved: (role: Role) => void;
}) {
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), values: toValues(initial) });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    const limits: Role["concurrency_limits"] = {};
    if (v.max_records_per_query) limits.max_records_per_query = Number(v.max_records_per_query);
    if (v.max_export_rows) limits.max_export_rows = Number(v.max_export_rows);
    const role: Role = {
      name: v.name,
      display_name: v.display_name,
      mcp_toolsets: v.mcp_toolsets,
      memory_paths: lines(v.memory_paths),
      cache_tables: lines(v.cache_tables),
      agents: lines(v.agents),
      admin_dashboard: v.admin_dashboard,
      ...(Object.keys(limits).length ? { concurrency_limits: limits } : {}),
    };
    setSaving(true);
    try {
      const r = await apiClient.roles.save(role);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      onSaved(role);
      onOpenChange(false);
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  });

  const options = ["*", ...toolsets];
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t("editTitle") : t("newTitle")}
      onSubmit={submit}
      saving={saving}
    >
      <Field label={t("name")} htmlFor="role-name" error={errors.name && t("nameHint")}>
        <Input id="role-name" {...form.register("name")} disabled={Boolean(initial)} />
      </Field>
      <Field
        label={t("displayName")}
        htmlFor="role-display"
        error={errors.display_name && tc("required")}
      >
        <Input id="role-display" {...form.register("display_name")} />
      </Field>
      <Field label={t("toolsets")}>
        <Controller
          control={form.control}
          name="mcp_toolsets"
          render={({ field }) => (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {options.map((name) => (
                <li key={name}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(name)}
                      onCheckedChange={(on) =>
                        field.onChange(
                          on === true
                            ? [...field.value, name]
                            : field.value.filter((x) => x !== name),
                        )
                      }
                    />
                    <span className="text-xs">{name === "*" ? t("allToolsets") : name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        />
      </Field>
      <Field label={t("memoryPaths")} htmlFor="role-memory" hint={t("onePerLine")}>
        <Textarea
          id="role-memory"
          rows={3}
          className="text-xs"
          {...form.register("memory_paths")}
        />
      </Field>
      <Field label={t("cacheTables")} htmlFor="role-cache" hint={t("onePerLine")}>
        <Textarea id="role-cache" rows={2} className="text-xs" {...form.register("cache_tables")} />
      </Field>
      <Field label={t("agents")} htmlFor="role-agents" hint={t("onePerLine")}>
        <Textarea id="role-agents" rows={2} className="text-xs" {...form.register("agents")} />
      </Field>
      <Controller
        control={form.control}
        name="admin_dashboard"
        render={({ field }) => (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={field.value} onCheckedChange={(on) => field.onChange(on === true)} />
            {t("adminDashboard")}
          </label>
        )}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("maxRecords")} htmlFor="role-max-records">
          <Input
            id="role-max-records"
            inputMode="numeric"
            {...form.register("max_records_per_query")}
          />
        </Field>
        <Field label={t("maxExport")} htmlFor="role-max-export">
          <Input id="role-max-export" inputMode="numeric" {...form.register("max_export_rows")} />
        </Field>
      </div>
    </FormDialog>
  );
}
