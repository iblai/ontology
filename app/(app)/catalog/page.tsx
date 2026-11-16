"use client";

import { StubPage, type StubRow } from "@/components/shell/stub-page";
import { useSystems } from "@/lib/data";

const n = (v: number | null) => (v === null ? "—" : String(v));

export default function Page() {
  return (
    <StubPage
      title="Catalog"
      description="Every database, schema, table and column the engine has read, with descriptions, tags and the terms mapped to each."
      query={useSystems()}
      rows={({ systems }) =>
        systems.map((s): StubRow => [
          `${s.name} · ${n(s.tables)} tables${s.scoped ? " (scoped)" : ""}`,
          s.status === "ingested"
            ? `${n(s.pii)} ${s.pii === 1 ? "column" : "columns"} tagged pii · ${n(s.terms)} terms`
            : s.status,
        ])
      }
    />
  );
}
