"use client";

import { StubPage, type StubRow } from "@/components/shell/stub-page";
import { useRoles } from "@/lib/data";

export default function Page() {
  return (
    <StubPage
      title="Roles"
      description="ibl.ai RBAC policies for this organization. Each policy grants one toolset; the gateway lends a caller the toolsets their policies grant."
      query={useRoles()}
      rows={(roles) =>
        roles.length
          ? roles.map((r): StubRow => [r.name, r.all ? "all toolsets" : r.toolsets.join(", ")])
          : [["No ontology role yet", "issue a token or attach an agent to create one"]]
      }
    />
  );
}
