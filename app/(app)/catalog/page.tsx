import { StubPage } from "@/components/shell/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Catalog"
      description="Every database, schema, table and column the engine has read, with descriptions, tags and the terms mapped to each."
      rows={[
        ["sis · 42 tables", "2 columns tagged pii · 9 terms"],
        ["lms · 5 tables (scoped)", "1 column tagged pii · 4 terms"],
        ["crm · 3 tables (scoped)", "1 column tagged pii · 3 terms"],
        ["finance · 3 tables", "compiling"],
      ]}
    />
  );
}
