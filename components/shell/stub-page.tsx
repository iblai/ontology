import { Card, PageHeader } from "@/components/shell/page-header";

/** Placeholder for console routes that are out of scope for the UX approval pass. */
export function StubPage({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: [string, string][];
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="p-0">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3 text-sm last:border-b-0"
          >
            <span className="font-semibold text-gray-900">{k}</span>
            <span className="text-gray-600">{v}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
