"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { McpToolset } from "@/lib/ontology/types";
import { Field, FormDialog } from "@/components/console/form-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  tools: z.array(z.string()).min(1),
});
type Values = z.infer<typeof schema>;

export function ToolsetDialog({
  open,
  onOpenChange,
  initial,
  tools,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: McpToolset;
  tools: string[];
  onSaved: () => void;
}) {
  const t = useTranslations("mcp.toolsets");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: { name: initial?.name ?? "", tools: initial?.tools ?? [] },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setSaving(true);
    try {
      const r = await apiClient.mcp.saveToolset({ kind: "toolset", ...v });
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
      <Field label={t("name")} htmlFor="toolset-name" error={errors.name && tc("required")}>
        <Input id="toolset-name" {...form.register("name")} disabled={Boolean(initial)} />
      </Field>
      <Field label={t("pick")} error={errors.tools && tc("required")}>
        <Controller
          control={form.control}
          name="tools"
          render={({ field }) => (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {tools.map((name) => (
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
                    <span className="text-xs">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        />
      </Field>
    </FormDialog>
  );
}
