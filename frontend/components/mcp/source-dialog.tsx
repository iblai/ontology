"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { McpSource } from "@/lib/ontology/types";
import { Field, FormDialog } from "@/components/console/form-dialog";
import { Input } from "@/components/ui/input";

const SOURCE_TYPES = [
  "postgres",
  "oracle",
  "mysql",
  "mssql",
  "sqlite",
  "snowflake",
  "trino",
  "clickhouse",
  "bigquery",
  "spanner",
];
const ENV_REF = /^(\$\{[A-Z0-9_]+\})?$/;

const schema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  type: z.string().min(1),
  host: z.string(),
  port: z.string().regex(/^(\d+|\$\{[A-Z0-9_]+\})?$/),
  database: z.string(),
  user: z.string(),
  password: z.string().regex(ENV_REF),
});
type Values = z.infer<typeof schema>;

export function SourceDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: McpSource;
  onSaved: () => void;
}) {
  const t = useTranslations("mcp.sources");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: initial?.name ?? "",
      type: initial?.type ?? "",
      host: initial?.host ?? "",
      port: initial?.port == null ? "" : String(initial.port),
      database: initial?.database ?? "",
      user: initial?.user ?? "",
      password: initial?.password ?? "",
    },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    const source: McpSource = { kind: "source", name: v.name, type: v.type };
    for (const key of ["host", "port", "database", "user", "password"] as const) {
      if (v[key]) source[key] = v[key];
    }
    setSaving(true);
    try {
      const r = await apiClient.mcp.saveSource(source);
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
      title={initial ? t("editTitle") : t("newTitle")}
      onSubmit={submit}
      saving={saving}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("name")} htmlFor="source-name" error={errors.name && tc("required")}>
          <Input id="source-name" {...form.register("name")} disabled={Boolean(initial)} />
        </Field>
        <Field label={t("type")} htmlFor="source-type" error={errors.type && tc("required")}>
          <Input id="source-type" list="source-types" {...form.register("type")} />
          <datalist id="source-types">
            {SOURCE_TYPES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label={t("host")} htmlFor="source-host">
          <Input id="source-host" {...form.register("host")} />
        </Field>
        <Field label={t("port")} htmlFor="source-port" error={errors.port && t("envHint")}>
          <Input id="source-port" {...form.register("port")} />
        </Field>
        <Field label={t("database")} htmlFor="source-database">
          <Input id="source-database" {...form.register("database")} />
        </Field>
        <Field label={t("user")} htmlFor="source-user">
          <Input id="source-user" {...form.register("user")} />
        </Field>
      </div>
      <Field
        label={t("password")}
        htmlFor="source-password"
        error={errors.password && t("envHint")}
        hint={t("envHint")}
      >
        <Input id="source-password" {...form.register("password")} />
      </Field>
    </FormDialog>
  );
}
