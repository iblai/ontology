import { StubPage } from "@/components/shell/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Compilation"
      description="The engine's ingest and compile status for this host, and the switches that control it."
      rows={[
        ["Compilation", "idle · last success 3h ago · last failure —"],
        ["Scheduled compilation", "on · after each ingest"],
        ["PII detection", "on"],
        ["Distinct-value probing", "on"],
        ["SQL query timeout", "60 s"],
        ["Server config reload", "automatic · last reload 12m ago (institution rev 8)"],
      ]}
    />
  );
}
