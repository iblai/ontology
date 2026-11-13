"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Pencil, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import { endpointName, listed } from "@/lib/ontology/connectable";
import type { ServiceEndpoint } from "@/lib/ontology/types";
import { ConfirmDelete } from "@/components/console/confirm-delete";
import { EmptyState } from "@/components/console/empty-state";
import { Field, FormDialog, PLAIN } from "@/components/console/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
/** The methods a JSON body goes with. */
const BODIES: readonly string[] = ["POST", "PUT", "PATCH"];

const schema = z.object({
  name: z.string().refine((typed) => endpointName(typed) !== ""),
  description: z.string().trim().min(1),
  method: z.enum(METHODS),
  // What the backend takes: plain segments, and {name} where a value goes.
  path: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9._~{}/-]+$/),
  query: z.string(),
  body: z.boolean(),
});
type Values = z.infer<typeof schema>;

/** The Endpoints tab of a custom API: each row is one tool an agent may call. */
export function ServiceEndpoints({ system }: { system: string }) {
  const t = useTranslations("serviceDetail.endpoints");
  const tc = useTranslations("common");
  const [endpoints, setEndpoints] = useState<ServiceEndpoint[] | null>(null);
  // The dialog is mounted per use, so a new endpoint never starts from the last one's fields.
  const [editing, setEditing] = useState<{ endpoint?: ServiceEndpoint } | null>(null);

  const reload = useCallback(() => {
    apiClient.services.endpoints(system).then(setEndpoints, (e: Error) => {
      setEndpoints([]);
      toast.error(e.message);
    });
  }, [system]);
  useEffect(reload, [reload]);

  async function remove(endpoint: ServiceEndpoint) {
    try {
      const r = await apiClient.services.removeEndpoint(system, endpoint.name);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch {
      toast.error(tc("failed"));
    }
    reload();
  }

  const add = (
    <Button size="sm" variant="outline" className="w-fit" onClick={() => setEditing({})}>
      <Plus className="mr-2 size-3.5" />
      {t("add")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t("subtitle", { role: system })}</p>
      {endpoints === null ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : endpoints.length === 0 ? (
        <EmptyState title={t("none")} hint={t("noneHint")} action={add} />
      ) : (
        <>
          {add}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{t("colName")}</TableHead>
                  <TableHead className="text-xs">{t("colMethod")}</TableHead>
                  <TableHead className="text-xs">{t("colPath")}</TableHead>
                  <TableHead className="text-xs">{t("colDoes")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{tc("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => (
                  <TableRow key={endpoint.tool}>
                    <TableCell className="text-foreground py-2 text-xs font-medium">
                      {endpoint.tool}
                    </TableCell>
                    <TableCell className="text-muted-foreground py-2 text-xs">
                      {endpoint.method}
                      {endpoint.write && <span className="ml-2">{tc("changesData")}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground py-2 text-xs">
                      {endpoint.path}
                    </TableCell>
                    <TableCell className="text-foreground py-2 text-xs">
                      {endpoint.description}
                    </TableCell>
                    <TableCell className="py-1">
                      <div className="flex items-center justify-end">
                        {/* An endpoint that changes data is not run as a test: a change is always recorded. */}
                        {!endpoint.write && (
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground h-8 px-2"
                          >
                            <Link
                              href={`/mcp/playground?tool=${encodeURIComponent(endpoint.tool)}`}
                            >
                              <Play className="size-3.5" />
                              {t("try")}
                            </Link>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-8 px-2"
                          aria-label={t("editTitle")}
                          onClick={() => setEditing({ endpoint })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <ConfirmDelete name={endpoint.tool} onConfirm={() => remove(endpoint)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {editing && (
        <EndpointDialog
          system={system}
          initial={editing.endpoint}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function EndpointDialog({
  system,
  initial,
  onClose,
  onSaved,
}: {
  system: string;
  initial?: ServiceEndpoint;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("serviceDetail.endpoints");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      method: initial?.method ?? "GET",
      path: initial?.path ?? "",
      query: initial?.query.join(", ") ?? "",
      body: initial?.body ?? true,
    },
  });
  const errors = form.formState.errors;
  const method = form.watch("method");
  const named = initial?.name ?? endpointName(form.watch("name"));

  const submit = form.handleSubmit(async (v) => {
    setSaving(true);
    try {
      const r = await apiClient.services.saveEndpoint(system, {
        name: named,
        description: v.description,
        method: v.method,
        path: v.path,
        query: listed(v.query),
        body: v.body && BODIES.includes(v.method),
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      onSaved();
      onClose();
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={initial ? t("editTitle") : t("newTitle")}
      onSubmit={submit}
      saving={saving}
    >
      <Field
        label={t("name")}
        htmlFor="endpoint-name"
        error={errors.name && tc("required")}
        hint={named ? t("nameHint", { tool: `${system}-${named}` }) : undefined}
      >
        <Input
          id="endpoint-name"
          placeholder={t("namePlaceholder")}
          {...form.register("name")}
          disabled={Boolean(initial)}
        />
      </Field>
      <Field
        label={t("does")}
        htmlFor="endpoint-does"
        error={errors.description && tc("required")}
        hint={t("doesHint")}
      >
        <Input id="endpoint-does" {...form.register("description")} />
      </Field>
      <Field label={t("method")} htmlFor="endpoint-method">
        <Controller
          control={form.control}
          name="method"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="endpoint-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <Field
        label={t("path")}
        htmlFor="endpoint-path"
        error={errors.path && t("pathInvalid")}
        hint={t("pathHint")}
      >
        <Input
          id="endpoint-path"
          placeholder="/invoices/{invoice_id}"
          {...form.register("path")}
          {...PLAIN}
        />
      </Field>
      <Field label={t("query")} htmlFor="endpoint-query" hint={t("queryHint")}>
        <Input
          id="endpoint-query"
          placeholder="status, limit"
          {...form.register("query")}
          {...PLAIN}
        />
      </Field>
      {BODIES.includes(method) && (
        <Controller
          control={form.control}
          name="body"
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                {t("body")}
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
              <p className="text-muted-foreground text-xs">{t("bodyHint")}</p>
            </div>
          )}
        />
      )}
    </FormDialog>
  );
}
