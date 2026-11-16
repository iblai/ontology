import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, PageHeader, Pill } from "@/components/shell/page-header";
import { servers } from "@/lib/mock";

const th = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";

export default function McpPage() {
  return (
    <>
      <PageHeader
        eyebrow="Gateway"
        title="MCP Servers"
        description="Each server is one generated config and one runtime process on the host, registered on ibl.ai so agents can attach it. Toolsets, authentication, allowed origins and hosts are set per server."
        actions={<Button size="lg" className="ibl-button-primary" render={<Link href="/mcp/new" />}>New MCP Server</Button>}
      />
      <Card className="p-0">
        <Table>
          <TableHeader><TableRow>{["Server", "Endpoint", "Toolsets", "Tools", "Agents", "Tool calls · 24h", "Status"].map((h) => <TableHead key={h} className={th + " px-4"}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {servers.map((s) => (
              <TableRow key={s.slug}>
                <TableCell className="px-4 font-semibold text-gray-900"><Link href={`/mcp/${s.slug}`} className="hover:text-[#0058cc]">{s.slug}</Link>{s.revision > 0 && <span className="ml-1.5 text-xs font-normal text-gray-500">rev {s.revision}</span>}</TableCell>
                <TableCell className="mono px-4">https://ontology.university.edu/{s.slug}/mcp</TableCell>
                <TableCell className="px-4 tabular-nums">{s.toolsets}</TableCell>
                <TableCell className="px-4 tabular-nums">{s.tools}</TableCell>
                <TableCell className="px-4 tabular-nums">{s.agents}</TableCell>
                <TableCell className="px-4 tabular-nums">{s.calls24h.toLocaleString()}</TableCell>
                <TableCell className="px-4">{s.enabled ? <Pill tone="green" dot>enabled</Pill> : <Pill tone="amber" dot>draft</Pill>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
