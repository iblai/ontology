import { StubPage } from "@/components/shell/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Config"
      description="Files the console writes to the host. Edits happen in the console; these are the artifacts the runtime reads."
      rows={[
        ["servers/institution/tools.yaml", "rev 8 · 9.8 KB · 19 tools · 3 toolsets"],
        [
          "servers/institution/flags",
          "--allowed-origins 4 · --allowed-hosts ontology.university.edu · --port 5001",
        ],
        ["servers/advancement/tools.yaml", "rev 3 · 9 tools"],
        ["semantic model export", "14 terms · 11 relationships · download from the engine"],
      ]}
    />
  );
}
