import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { CATALOG } from "@/lib/ontology/catalog";
import { SectionHeader } from "@/components/console/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/console/code-block";

export default async function CatalogDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const entry = CATALOG.find((c) => c.key === key);
  if (!entry) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="px-2">
          <Link href="/catalog">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <SectionHeader
          title={entry.display_name}
          subtitle={<span className="font-mono text-xs">{entry.key}</span>}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link href={`/services/add?from=${entry.key}`}>
            <Plus className="mr-2 size-3.5" />
            Seed new service from this entry
          </Link>
        </Button>
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
            <p className="text-sm text-foreground">{entry.summary || "No summary available."}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Properties</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Row label="Type" value={<span className="font-mono text-xs">{entry.type}</span>} />
            <Row label="Domain" value={<span className="font-mono text-xs">{entry.domain}</span>} />
            <Row
              label="Adapter"
              value={<span className="font-mono text-xs">{entry.adapter}</span>}
            />
            <Row
              label="Default toolset"
              value={<span className="font-mono text-xs">{entry.default_toolset}</span>}
            />
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
            <ul className="flex flex-col gap-1">
              {entry.env.map((e) => (
                <li key={e} className="font-mono text-xs text-foreground">
                  {e}
                </li>
              ))}
            </ul>
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
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{k}</td>
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{v}</td>
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
