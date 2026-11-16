"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttachDialog } from "@/components/attach-dialog";
import { Card, PageHeader, Pill, Tag } from "@/components/shell/page-header";
import { QueryState } from "@/components/query-state";
import { useAgents } from "@/lib/data";

const th = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";
const headers = ["Agent", "Sign-in", "Server", "Tool calls · 24h", "Status"];

export default function AgentsPage() {
  const agents = useAgents();
  const [attaching, setAttaching] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="Gateway"
        title="Agents"
        description="ibl.ai agents that have an ontology server attached. How each one signs in comes from the server's connection: a platform token, a per-agent token, or each user's own session."
        actions={
          <Button size="lg" className="ibl-button-primary" onClick={() => setAttaching(true)}>
            Attach a Server to an Agent
          </Button>
        }
      />
      <Card className="p-0">
        <QueryState query={agents} className="px-4">
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h} className={th + " px-4"}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={headers.length} className="px-4 text-gray-500">
                      No agent has a server attached.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((a) => (
                  <TableRow key={`${a.id}-${a.server}`}>
                    <TableCell className="px-4 font-semibold text-gray-900">
                      {a.name}{" "}
                      <span className="ml-1 text-xs font-normal text-gray-500">{a.kind}</span>
                    </TableCell>
                    <TableCell className="px-4">
                      <Tag>{a.authType}</Tag> <Tag>scope · {a.authScope}</Tag>
                    </TableCell>
                    <TableCell className="mono px-4">
                      <Link href={`/mcp/${a.server}`} className="hover:text-[#0058cc]">
                        {a.server}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 tabular-nums">{a.calls.toLocaleString()}</TableCell>
                    <TableCell className="px-4">
                      <Pill tone="green" dot>
                        {a.status}
                      </Pill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <AttachDialog open={attaching} onOpenChange={setAttaching} />
    </>
  );
}
