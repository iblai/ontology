import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CATALOG } from "@/lib/ontology/catalog";
import { connectable } from "@/lib/ontology/connectable";
import { SectionHeader } from "@/components/console/section-header";
import { FactRow, Facts } from "@/components/console/facts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/console/code-block";

export default async function CatalogDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const entry = CATALOG.find((c) => c.key === key);
  if (!entry) notFound();
  // By adapter: the catalog's `banner` is its REST API, not the Oracle engine of that name.
  const connector = connectable(entry.adapter);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={entry.display_name}
        subtitle={<span className="text-xs">{entry.key}</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {connector ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/services/add?from=${connector.key}`}>
              <Plus className="mr-2 size-3.5" />
              Connect this system
            </Link>
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">No connector yet</span>
        )}
        {entry.skill && (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`https://github.com/iblai/${entry.domain === "enterprise" ? "enterprise-agents" : "higher-education-agents"}/blob/main/skills/${entry.skill.replace(".md", "")}/SKILL.md`}
              target="_blank"
              rel="noreferrer"
            >
              View upstream skill
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground text-sm">{entry.summary || "No summary available."}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Properties</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts>
              <FactRow label="Type" value={<span className="text-xs">{entry.type}</span>} />
              <FactRow label="Domain" value={<span className="text-xs">{entry.domain}</span>} />
              <FactRow label="Adapter" value={<span className="text-xs">{entry.adapter}</span>} />
              <FactRow
                label="Default toolset"
                value={<span className="text-xs">{entry.default_toolset}</span>}
              />
            </Facts>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Connection shape</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock code={JSON.stringify(entry.connection, null, 2)} language="yaml" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Required environment variables</CardTitle>
          </CardHeader>
          <CardContent>
            {entry.env.length ? (
              <ul className="flex flex-col gap-1">
                {entry.env.map((e) => (
                  <li key={e} className="text-foreground text-xs">
                    {e}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">
                None: its address and key are entered when it is connected.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Default sync cadences</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(entry.sync_defaults).map(([k, v]) => (
                    <tr key={k} className="border-b last:border-b-0">
                      <td className="text-muted-foreground px-3 py-2 text-xs">{k}</td>
                      <td className="text-foreground px-3 py-2 text-xs">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
