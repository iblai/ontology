// The source kinds the product knows: the intersection of the engine's connectors and the
// runtime's source kinds. Static, not fetched.

export type CatalogKind = {
  name: string;
  abbr: string;
  color: string;
  group: "db" | "wh" | "api" | "gc" | "fs";
  dissect: boolean; // the engine supports it
  serve: boolean; // the runtime has a source kind
};

export const catalog: CatalogKind[] = [
  { name: "PostgreSQL", abbr: "PG", color: "#336791", group: "db", dissect: true, serve: true },
  { name: "MySQL", abbr: "My", color: "#E48E00", group: "db", dissect: true, serve: true },
  { name: "SQL Server", abbr: "MS", color: "#A4373A", group: "db", dissect: false, serve: true },
  { name: "Oracle", abbr: "Or", color: "#C74634", group: "db", dissect: false, serve: true },
  { name: "Snowflake", abbr: "Sf", color: "#29B5E8", group: "wh", dissect: true, serve: true },
  { name: "BigQuery", abbr: "BQ", color: "#4285F4", group: "gc", dissect: false, serve: true },
  { name: "Databricks", abbr: "Db", color: "#FF3621", group: "wh", dissect: true, serve: false },
  { name: "ClickHouse", abbr: "CH", color: "#C9A200", group: "wh", dissect: true, serve: true },
  { name: "Trino", abbr: "Tr", color: "#DD00A1", group: "wh", dissect: true, serve: true },
  { name: "AlloyDB", abbr: "Al", color: "#4285F4", group: "gc", dissect: true, serve: true },
  { name: "Cloud SQL", abbr: "CS", color: "#4285F4", group: "gc", dissect: true, serve: true },
  { name: "Spanner", abbr: "Sp", color: "#4285F4", group: "gc", dissect: false, serve: true },
  { name: "Firestore", abbr: "Fs", color: "#F5820D", group: "gc", dissect: false, serve: true },
  { name: "MongoDB", abbr: "Mo", color: "#47A248", group: "db", dissect: false, serve: true },
  { name: "Neo4j", abbr: "N4", color: "#018BFF", group: "db", dissect: false, serve: true },
  { name: "Redis", abbr: "Rd", color: "#DC382D", group: "db", dissect: false, serve: true },
  { name: "Elasticsearch", abbr: "Es", color: "#C9A200", group: "db", dissect: false, serve: true },
  { name: "HTTP API", abbr: "API", color: "#FF7A59", group: "api", dissect: false, serve: true },
  {
    name: "OpenAPI spec",
    abbr: "OAS",
    color: "#6BA539",
    group: "api",
    dissect: false,
    serve: true,
  },
  { name: "Filesystem", abbr: "FS", color: "#64748B", group: "fs", dissect: false, serve: true },
];

// The engine's connector types (lib/ao-types.ts AoConnectionConfig) by catalog name.
const byConnector: Record<string, string> = {
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  snowflake: "Snowflake",
  databricks: "Databricks",
  clickhouse: "ClickHouse",
  trino: "Trino",
};

/** Display name, abbreviation and colour for an engine connector type; grey when unknown. */
export function engineKind(connector: string): { name: string; abbr: string; color: string } {
  const known = catalog.find((c) => c.name === byConnector[connector.toLowerCase()]);
  if (known) return known;
  const name = connector || "—";
  return { name, abbr: name.slice(0, 2).replace(/^./, (c) => c.toUpperCase()), color: "#9ca3af" };
}
