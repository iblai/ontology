"use client";

import { both, StubPage, type StubRow } from "@/components/shell/stub-page";
import { useAgents, useRoles } from "@/lib/data";

const SIGN_IN: Record<string, string> = {
  user: "per-user sign-in",
  mentor: "per-agent token",
  platform: "organization token",
};

export default function Page() {
  return (
    <StubPage
      title="Access"
      description="Who holds which policy on ibl.ai, and which agents hold a connection to a server."
      query={both(useRoles(), useAgents())}
      rows={([roles, agents]) => [
        ...roles.flatMap((r) =>
          r.holders.map((h): StubRow => {
            const who =
              h.kind === "user" ? "user" : h.users === null ? "group" : `group · ${h.users} users`;
            return [`${h.label} (${who})`, r.name];
          }),
        ),
        ...agents.map((a): StubRow => [
          `${a.name} (agent)`,
          `${a.server} · ${SIGN_IN[a.authScope] ?? a.authScope}`,
        ]),
      ]}
    />
  );
}
