"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingScreen } from "@/components/loading-screen";
import { QueryState } from "@/components/query-state";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import { useActions, useObjectType, useOntology } from "@/lib/data";
import type { ObjectTypeView } from "@/lib/view/types";
import { cn } from "@/lib/utils";

function TreeGroup<T>({
  title,
  items,
  limit,
  children,
}: {
  title: string;
  items: T[];
  limit: number;
  children: (item: T, i: number) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const more = all ? 0 : items.length - limit;
  return (
    <div>
      <h4 className="eyebrow mt-3.5 mb-1.5 first:mt-0">
        {title} <span className="ml-1 font-normal text-gray-400">{items.length}</span>
      </h4>
      {(all ? items : items.slice(0, limit)).map(children)}
      {more > 0 && (
        <button
          type="button"
          aria-label={`Show ${more} more ${title.toLowerCase()}`}
          onClick={() => setAll(true)}
          className="h-8 w-full px-2 text-left text-[13.5px] text-gray-400"
        >
          + {more} more
        </button>
      )}
    </div>
  );
}
function TreeItem({
  color,
  label,
  right,
  active,
  onClick,
}: {
  color: string;
  label: string;
  right?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-gray-700 hover:bg-[var(--hover-bg)]",
        active && "bg-[#eef6fc] font-medium text-[#0058cc] hover:bg-[#eef6fc]",
      )}
    >
      <span className="size-[9px] shrink-0 rounded-[3px]" style={{ background: color }} />
      {label}
      {right && <span className="ml-auto text-[11px] text-gray-400">{right}</span>}
    </button>
  );
}
const th = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";
const none = <p className="text-[12.5px] text-gray-600">none</p>;

/** Actions by key: one in flight disables its control, a rejection keeps its message. */
function useRun() {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function run(key: string, act: () => Promise<void>): Promise<boolean> {
    setPending((p) => ({ ...p, [key]: true }));
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      await act();
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: err instanceof Error ? err.message : String(err) }));
      return false;
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }
  return { pending, errors, run };
}

function Failed({ message, className }: { message?: string; className?: string }) {
  return message ? <p className={cn("text-[12.5px] text-red-600", className)}>{message}</p> : null;
}

export default function OntologyPage() {
  return (
    <Suspense fallback={<LoadingScreen className="min-h-40 bg-transparent" />}>
      <OntologyManager />
    </Suspense>
  );
}

function OntologyManager() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tree = useOntology();
  const selected = params.get("term") ?? tree.data?.objectTypes[0]?.id ?? null;
  const detail = useObjectType(selected);

  function select(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("term", id);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        eyebrow="Step 3 · Model"
        title="Ontology"
        description="Terms become object types, joins become link types, SQL attributes become metrics. Certify what is right, fix what is not. Only certified definitions are compiled into tools."
        actions={
          <>
            {tree.data && (
              <>
                <Pill tone="amber">{tree.data.suggested} suggested</Pill>
                <Pill tone="green">{tree.data.certified} certified</Pill>
              </>
            )}
            <Button
              size="lg"
              variant="outline"
              className="ibl-outline-primary"
              render={<Link href="/mcp/new" />}
            >
              Expose as MCP
            </Button>
          </>
        }
      />
      <QueryState query={tree}>
        {(t) => (
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)]">
            <Card className="h-fit">
              <TreeGroup title="Object Types" items={t.objectTypes} limit={9}>
                {(o) => (
                  <TreeItem
                    key={o.id}
                    color="#0058cc"
                    label={o.name}
                    right={
                      o.status === "suggested"
                        ? "new"
                        : o.systems > 1
                          ? `${o.systems} systems`
                          : undefined
                    }
                    active={o.id === selected}
                    onClick={() => select(o.id)}
                  />
                )}
              </TreeGroup>
              <TreeGroup title="Link Types" items={t.linkTypes} limit={3}>
                {(l, i) => <TreeItem key={`${i}:${l}`} color="#00b0ef" label={l} />}
              </TreeGroup>
              <TreeGroup title="Metrics" items={t.metrics} limit={3}>
                {(l, i) => <TreeItem key={`${i}:${l}`} color="#10b981" label={l} />}
              </TreeGroup>
              <TreeGroup title="Actions" items={t.actions} limit={2}>
                {(l, i) => <TreeItem key={`${i}:${l}`} color="#f59e0b" label={l} />}
              </TreeGroup>
              <TreeGroup title="Tags" items={t.tags} limit={2}>
                {(l, i) => <TreeItem key={`${i}:${l}`} color="#9ca3af" label={l} />}
              </TreeGroup>
            </Card>

            <Card>
              {selected ? (
                <QueryState query={detail}>
                  {(view) => <ObjectTypeDetail key={view.id} view={view} />}
                </QueryState>
              ) : (
                none
              )}
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}

function ObjectTypeDetail({ view }: { view: ObjectTypeView }) {
  const actions = useActions();
  const { pending, errors, run } = useRun();
  const [draft, setDraft] = useState<{ name: string; description: string } | null>(null);
  const certified = view.status === "certified";

  async function save() {
    if (!draft) return;
    if (await run("save", () => actions.saveTerm(view.id, draft))) setDraft(null);
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3.5">
        <div className="grid size-[42px] place-items-center rounded-[10px] bg-[#eef6fc] text-lg font-bold text-[#0058cc]">
          {view.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-[200px] flex-1">
          {draft ? (
            <Input
              aria-label="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          ) : (
            <h2 className="text-lg font-semibold text-gray-900">{view.name}</h2>
          )}
          <div className="text-[12.5px] text-gray-600">
            {draft ? (
              <Textarea
                aria-label="Description"
                className="mt-1"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            ) : (
              view.description
            )}
            {view.tags.length > 0 && (
              <>
                {" "}
                Tagged{" "}
                {view.tags.map((tag, i) => (
                  <span key={`${i}:${tag}`}>
                    {i > 0 && ", "}
                    <b>{tag}</b>
                  </span>
                ))}
                .
              </>
            )}
            {view.systems > 1 && ` Mapped to tables in ${view.systems} systems.`}
          </div>
        </div>
        <button
          type="button"
          aria-label={certified ? `Uncertify ${view.name}` : `Certify ${view.name}`}
          disabled={pending.certify}
          onClick={() => run("certify", () => actions.certifyTerm(view.id, !certified))}
          className="disabled:opacity-50"
        >
          <Pill tone={certified ? "green" : "amber"} dot>
            {view.status}
          </Pill>
        </button>
        {draft ? (
          <>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Save ${view.name}`}
              disabled={pending.save}
              onClick={save}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label="Cancel editing"
              disabled={pending.save}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ name: view.name, description: view.description })}
          >
            Edit
          </Button>
        )}
        <Failed message={errors.certify} className="basis-full" />
        <Failed message={errors.save} className="basis-full" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
        Synonyms
        {view.synonyms.length === 0 && " none"}
        {view.synonyms.map((s, i) => (
          <span
            key={`${i}:${s}`}
            className="mono rounded-full bg-[var(--hover-bg)] px-2.5 py-1 text-gray-700"
          >
            {s}
          </span>
        ))}
      </div>

      <Section title="Backing Datasets" hint="· from term → column mapping">
        {view.backing.length === 0 ? (
          none
        ) : (
          <div className="flex flex-wrap gap-2">
            {view.backing.map((b, i) => (
              <div
                key={`${i}:${b.name}`}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-2.5 py-2 text-[12.5px] text-gray-600"
              >
                <span className="size-[9px] rounded-[3px]" style={{ background: b.color }} />
                <code className="mono text-gray-900">{b.name}</code>
                <span>{b.note}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Properties" hint={<Pill>{view.properties.length}</Pill>}>
        {view.properties.length === 0 ? (
          none
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={th}>Property</TableHead>
                  <TableHead className={th}>Type</TableHead>
                  <TableHead className={th}>Backing column</TableHead>
                  <TableHead className={th}>Flags</TableHead>
                  <TableHead className={th}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.properties.map((p) => {
                  const on = p.status === "certified";
                  const key = `property:${p.id}`;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-semibold text-gray-900">
                        {p.name}
                        {p.key && (
                          <span className="ml-1 text-xs font-normal text-gray-500">key</span>
                        )}
                      </TableCell>
                      <TableCell className="mono">{p.type}</TableCell>
                      <TableCell className="mono">{p.column}</TableCell>
                      <TableCell>{p.pii && <Tag tone="red">PII</Tag>}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          aria-label={on ? `Uncertify ${p.name}` : `Certify ${p.name}`}
                          disabled={pending[key]}
                          onClick={() =>
                            run(key, () => actions.certifyProperty(view.id, p.id, !on))
                          }
                          className="disabled:opacity-50"
                        >
                          <Tag tone={on ? "green" : "amber"}>{p.status}</Tag>
                        </button>
                        <Failed message={errors[key]} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Links">
        {view.links.length === 0 ? (
          none
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {view.links.map((l, i) => (
              <div
                key={`${i}:${l.name}`}
                className="rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[12.5px] text-gray-700"
              >
                <b className="mono font-semibold text-[#0058cc]">{l.name}</b> {l.dir} {l.target}
                <small className="mt-0.5 block text-gray-600">{l.via}</small>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Metrics" hint="· certified SQL expressions">
        {view.metrics.length === 0 ? (
          none
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={th}>Metric</TableHead>
                  <TableHead className={th}>Expression</TableHead>
                  <TableHead className={th}>Grain</TableHead>
                  <TableHead className={th}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.metrics.map((m) => {
                  const on = m.status === "certified";
                  const key = `metric:${m.id}`;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-semibold text-gray-900">{m.name}</TableCell>
                      <TableCell>
                        <code className="mono">{m.expr}</code>
                      </TableCell>
                      <TableCell>{m.grain}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          aria-label={on ? `Uncertify ${m.name}` : `Certify ${m.name}`}
                          disabled={pending[key]}
                          onClick={() => run(key, () => actions.certifyMetric(m.id, !on))}
                          className="disabled:opacity-50"
                        >
                          <Tag tone={on ? "green" : "amber"}>{m.status}</Tag>
                        </button>
                        <Failed message={errors[key]} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Actions" hint="· write tools in the server config, gated by toolset">
        {view.actions.length === 0 ? (
          none
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
            {view.actions.map((a, i) => (
              <div
                key={`${i}:${a.name}`}
                className="rounded-lg border border-[var(--border-color)] bg-[#fafbfc] px-3 py-2.5 text-[12.5px] text-gray-700"
              >
                <b className="mono font-semibold text-[#0058cc]">{a.name}</b>
                {a.sig}
                <small className="mt-0.5 block text-gray-600">{a.via}</small>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        {title} {hint && <span className="text-xs font-normal text-gray-600">{hint}</span>}
      </h3>
      {children}
    </div>
  );
}
