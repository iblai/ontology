"use client";

import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { McpTool } from "@/lib/ontology/types";
import { Field, FormDialog } from "@/components/console/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const TOOL_TYPES = [
  "postgres-sql",
  "oracle-sql",
  "mysql-sql",
  "mssql-sql",
  "sqlite-sql",
  "snowflake-sql",
  "trino-sql",
  "clickhouse-sql",
  "http",
];

const schema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  type: z.string().min(1),
  source: z.string().min(1),
  description: z.string().min(1),
  statement: z.string(),
  parameters: z.array(
    z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      description: z.string(),
      required: z.boolean(),
    }),
  ),
});
type Values = z.infer<typeof schema>;

export function ToolDialog({
  open,
  onOpenChange,
  initial,
  sources,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: McpTool;
  sources: string[];
  onSaved: () => void;
}) {
  const t = useTranslations("mcp.tools");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: initial?.name ?? "",
      type: initial?.type ?? "",
      source: initial?.source ?? "",
      description: initial?.description ?? "",
      statement: initial?.statement ?? "",
      parameters: (initial?.parameters ?? []).map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required ?? false,
      })),
    },
  });
  const params = useFieldArray({ control: form.control, name: "parameters" });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setSaving(true);
    try {
      const r = await apiClient.mcp.saveTool({ kind: "tool", ...v });
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
      <Field label={t("name")} htmlFor="tool-name" error={errors.name && tc("required")}>
        <Input id="tool-name" {...form.register("name")} disabled={Boolean(initial)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("type")} htmlFor="tool-type" error={errors.type && tc("required")}>
          <Input id="tool-type" list="tool-types" {...form.register("type")} />
          <datalist id="tool-types">
            {TOOL_TYPES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label={t("source")} htmlFor="tool-source" error={errors.source && tc("required")}>
          <Input id="tool-source" list="tool-sources" {...form.register("source")} />
          <datalist id="tool-sources">
            {sources.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </datalist>
        </Field>
      </div>
      <Field
        label={t("description")}
        htmlFor="tool-description"
        error={errors.description && tc("required")}
      >
        <Input id="tool-description" {...form.register("description")} />
      </Field>
      <Field label={t("statement")} htmlFor="tool-statement">
        <Textarea
          id="tool-statement"
          rows={4}
          className="font-mono text-xs"
          {...form.register("statement")}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("parameters")}</p>
        {params.fields.map((field, i) => (
          <div
            key={field.id}
            className="grid grid-cols-[1fr_1fr_1.5fr_auto_auto] items-center gap-2"
          >
            <Input
              aria-label={t("paramName")}
              placeholder={t("paramName")}
              className="text-xs"
              {...form.register(`parameters.${i}.name`)}
            />
            <Input
              aria-label={t("paramType")}
              placeholder={t("paramType")}
              className="text-xs"
              {...form.register(`parameters.${i}.type`)}
            />
            <Input
              aria-label={t("paramDescription")}
              placeholder={t("paramDescription")}
              className="text-xs"
              {...form.register(`parameters.${i}.description`)}
            />
            <Controller
              control={form.control}
              name={`parameters.${i}.required`}
              render={({ field: f }) => (
                <label className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Checkbox checked={f.value} onCheckedChange={(on) => f.onChange(on === true)} />
                  {t("paramRequired")}
                </label>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-8 w-8 p-0"
              aria-label={t("removeParameter")}
              onClick={() => params.remove(i)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            params.append({ name: "", type: "string", description: "", required: false })
          }
        >
          <Plus className="mr-2 size-3.5" />
          {t("addParameter")}
        </Button>
      </div>
    </FormDialog>
  );
}
