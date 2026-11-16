import { StubPage } from "@/components/shell/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Roles"
      description="ibl.ai RBAC policies for this organization. A policy names the toolsets a caller may use; the gateway maps the caller's policy to the toolset it forwards to."
      rows={[
        ["ontology:admin", "all toolsets"],
        ["ontology:advising", "advising, registrar, advising-actions"],
        ["ontology:enrollment", "enrollment, registrar"],
        ["ontology:self-service", "my_* tools · rows bound to the signed-in email"],
        ["ontology:raw", "raw-sql"],
      ]}
    />
  );
}
