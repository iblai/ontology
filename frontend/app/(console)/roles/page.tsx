"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, UserCog } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { apiClient } from "@/lib/ontology/api-client";
import type { Role } from "@/lib/ontology/types";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
import { EmptyState } from "@/components/console/empty-state";
import { ConfirmDelete } from "@/components/console/confirm-delete";
import { RoleDialog } from "@/components/roles/role-dialog";
import { useCreateParam } from "@/components/shell/use-create-param";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function RolesPage() {
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const ta = useTranslations("access.levelName");
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  useCreateParam("role", () => setEditing("new"));

  const load = useCallback(() => {
    apiClient.roles
      .list()
      .then(setRoles)
      .catch((e) => console.error("roles load failed", e));
  }, []);

  useEffect(load, [load]);

  async function remove(name: string) {
    const r = await apiClient.roles.remove(name);
    if (r.ok) {
      toast.success(r.message);
      setRoles((prev) => prev?.filter((x) => x.name !== name) ?? null);
    } else {
      toast.error(r.message);
    }
  }

  const columns: ColumnDef<Role, unknown>[] = [
    {
      accessorKey: "display_name",
      header: sortableHeader(t("colName")),
      cell: ({ row }) => (
        <span className="text-foreground text-sm font-medium">{row.original.display_name}</span>
      ),
    },
    {
      accessorKey: "name",
      header: sortableHeader(t("colTechnicalName")),
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.name}</span>,
    },
    // How far each role reaches, where the backend says so.
    ...(roles?.some((r) => r.access)
      ? [
          {
            id: "access",
            header: t("colAccess"),
            cell: ({ row }) => (
              <span className="text-muted-foreground text-xs">
                {row.original.access ? ta(row.original.access) : ""}
              </span>
            ),
          } satisfies ColumnDef<Role, unknown>,
        ]
      : []),
    {
      accessorKey: "mcp_toolsets",
      header: t("colToolsets"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {[
            ...row.original.mcp_toolsets.map((n) => (n === "*" ? t("allToolsets") : n)),
            // The tools it holds by name, beside its toolsets.
            ...(row.original.mcp_tools?.length
              ? [t("toolCount", { n: row.original.mcp_tools.length })]
              : []),
          ].join(", ")}
        </span>
      ),
    },
    {
      accessorKey: "admin_dashboard",
      header: t("colAdmin"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {row.original.admin_dashboard ? tc("yes") : tc("no")}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <ConfirmDelete name={row.original.name} onConfirm={() => remove(row.original.name)} />
      ),
    },
  ];

  const addButton = (
    <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
      <Plus className="mr-2 size-3.5" />
      {t("add")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      {roles === null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : roles.length === 0 ? (
        <EmptyState icon={UserCog} title={t("empty")} action={addButton} />
      ) : (
        <DataTable
          columns={columns}
          data={roles}
          toolbar={addButton}
          onRowClick={(role) => setEditing(role)}
          pageSize={15}
        />
      )}
      <RoleDialog
        key={editing === "new" ? "new" : (editing?.name ?? "closed")}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        initial={editing === "new" ? undefined : (editing ?? undefined)}
        taken={(roles ?? []).map((r) => r.name)}
        // The row follows each save in place: an open dialog saves with every switch.
        onSaved={(saved) => {
          setRoles((prev) =>
            prev?.some((r) => r.name === saved.name)
              ? prev.map((r) => (r.name === saved.name ? saved : r))
              : [...(prev ?? []), saved],
          );
          // How far it now reaches is the backend's to say.
          load();
        }}
      />
    </div>
  );
}
