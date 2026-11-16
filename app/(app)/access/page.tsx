import { StubPage } from "@/components/shell/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Access"
      description="Who holds which policy on ibl.ai, and which agents hold a connection to a server."
      rows={[
        ["advisors (group · 412 users)", "ontology:advising"],
        ["ir-analysts (group · 9 users)", "ontology:enrollment"],
        ["agentAI (agent)", "institution · per-user sign-in"],
        ["advising-bot (agent)", "institution · per-agent token"],
        ["ir-analyst (agent)", "institution · organization token"],
      ]}
    />
  );
}
