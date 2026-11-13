"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import { holders } from "@/lib/ontology/connectable";
import type { Service } from "@/lib/ontology/types";
import { fmtDateTime } from "@/lib/format";
import { EmptyState } from "@/components/console/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** How many of a system's named tables the Terms tab lists. */
const LISTED = 200;

/** The Terms tab of a database system: the term a model wrote for each table, on an administrator's word. */
export function GeneratedTerms({ service }: { service: Service }) {
  const t = useTranslations("serviceDetail.generatedTerms");
  const tc = useTranslations("common");
  // The terms change with every press; the page's own copy does not.
  const [current, setCurrent] = useState(service);
  const [working, setWorking] = useState(false);

  async function generate() {
    setWorking(true);
    try {
      const r = await apiClient.services.generateTerms(current.name);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      const fresh = await apiClient.services.get(current.name);
      if (fresh) setCurrent(fresh);
    } catch {
      toast.error(tc("failed"));
    } finally {
      setWorking(false);
    }
  }

  const tables = current.schema_manifest?.tables ?? [];
  const named = tables.filter((table) => table.term);
  if (tables.length === 0) return <EmptyState title={t("none")} hint={t("noneHint")} />;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="w-fit" onClick={generate} disabled={working}>
          {t(working ? "generating" : "generate")}
        </Button>
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link href="/map">{t("openMap")}</Link>
        </Button>
      </div>
      <p className="text-foreground text-xs">
        {t("summary", { named: named.length, total: tables.length })}
      </p>
      {named.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t("colTable")}</TableHead>
                <TableHead className="text-xs">{t("colTerm")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {named.slice(0, LISTED).map((table) => (
                <TableRow key={`${table.schema_name}.${table.table_name}`}>
                  <TableCell className="text-muted-foreground py-2 text-xs">
                    {table.table_name}
                  </TableCell>
                  <TableCell className="text-foreground py-2 text-xs font-medium">
                    {table.term}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {named.length > LISTED && (
        <p className="text-muted-foreground text-xs">{t("more", { n: named.length - LISTED })}</p>
      )}
      <p className="text-muted-foreground text-xs">{t("rule")}</p>
    </div>
  );
}

/** The Terms tab of an Auto Ontology server: what was read from it, and which systems here its databases are. */
export function ServiceTerms({ service }: { service: Service }) {
  const t = useTranslations("serviceDetail.terms");
  const tc = useTranslations("common");
  // The reading changes when it is read again; the page's own copy does not.
  const [current, setCurrent] = useState(service);
  const [systems, setSystems] = useState<Service[] | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    apiClient.services.list().then(setSystems, (e: Error) => {
      setSystems([]);
      toast.error(e.message);
    });
  }, []);

  async function readAgain() {
    setReading(true);
    try {
      const r = await apiClient.services.discover(current.name);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      const fresh = await apiClient.services.get(current.name);
      if (fresh) setCurrent(fresh);
    } catch {
      toast.error(tc("failed"));
    } finally {
      setReading(false);
    }
  }

  const read = current.schema_manifest;
  const terms = read?.terms ?? 0;
  const of = read?.of ?? terms;
  const again = (
    <Button size="sm" variant="outline" className="w-fit" onClick={readAgain} disabled={reading}>
      <RefreshCw className="mr-2 size-3.5" />
      {t(reading ? "reading" : "readAgain")}
    </Button>
  );

  if (terms === 0) return <EmptyState title={t("none")} hint={t("noneHint")} action={again} />;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {again}
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link href="/map">{t("openMap")}</Link>
        </Button>
      </div>
      <p className="text-foreground text-xs">
        {t(of > terms ? "summaryCut" : "summary", {
          terms,
          of,
          read: fmtDateTime(current.last_discovery_at),
        })}
      </p>
      {systems === null ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t("colDatabase")}</TableHead>
                <TableHead className="text-right text-xs">{t("colTerms")}</TableHead>
                <TableHead className="text-xs">{t("colSystem")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(read?.databases ?? []).map((database) => {
                const held = holders(systems, database.name);
                return (
                  <TableRow key={database.name}>
                    <TableCell className="text-foreground py-2 text-xs font-medium">
                      {database.name}
                    </TableCell>
                    <TableCell className="py-2 text-right text-xs tabular-nums">
                      {database.terms}
                    </TableCell>
                    <TableCell className="text-muted-foreground py-2 text-xs">
                      {held.length === 1 ? (
                        <Link
                          href={`/services/${encodeURIComponent(held[0].name)}`}
                          className="text-foreground hover:underline"
                        >
                          {held[0].name}
                        </Link>
                      ) : held.length === 0 ? (
                        t("noSystem")
                      ) : (
                        t("severalSystems", { names: held.map((s) => s.name).join(", ") })
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">{t("rule")}</p>
    </div>
  );
}
