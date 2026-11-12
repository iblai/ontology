/** What the console connects by itself: Twenty over its API, and the nine database engines. */
export interface Connectable {
  /** What `?from=` and the picker name it by: the catalog key of an application, an engine's adapter. */
  key: string;
  /** The backend's adapter. */
  adapter: string;
  label: string;
  kind: "twenty" | "database";
  /** An engine's usual port; absent for one that takes none (Snowflake). */
  port?: number;
  /** The backend can list this engine's databases, so the name is picked, not typed. */
  lookup?: boolean;
}

/** Where a workspace on Twenty's own cloud is reached. */
export const TWENTY_CLOUD = "https://api.twenty.com";

// Trino, ClickHouse and Snowflake run on NVIDIA auto-ontology.
export const CONNECTABLE: Connectable[] = [
  { key: "twenty", adapter: "twenty_api", label: "Twenty CRM", kind: "twenty" },
  {
    key: "generic-postgres",
    adapter: "generic-postgres",
    label: "PostgreSQL",
    kind: "database",
    port: 5432,
    lookup: true,
  },
  {
    key: "generic-mysql",
    adapter: "generic-mysql",
    label: "MySQL",
    kind: "database",
    port: 3306,
    lookup: true,
  },
  {
    key: "generic-oracle",
    adapter: "generic-oracle",
    label: "Oracle",
    kind: "database",
    port: 1521,
  },
  {
    key: "generic-mssql",
    adapter: "generic-mssql",
    label: "SQL Server",
    kind: "database",
    port: 1433,
  },
  { key: "generic-trino", adapter: "generic-trino", label: "Trino", kind: "database", port: 8080 },
  {
    key: "generic-clickhouse",
    adapter: "generic-clickhouse",
    label: "ClickHouse",
    kind: "database",
    port: 8123,
  },
  { key: "snowflake", adapter: "snowflake", label: "Snowflake", kind: "database" },
  {
    key: "peoplesoft",
    adapter: "peoplesoft",
    label: "PeopleSoft (Oracle)",
    kind: "database",
    port: 1521,
  },
  { key: "banner", adapter: "banner", label: "Banner (Oracle)", kind: "database", port: 1521 },
];

/** The connectable system a key or an adapter names; undefined for one with no connector here. */
export const connectable = (name: string | null | undefined): Connectable | undefined =>
  CONNECTABLE.find((c) => c.key === name || c.adapter === name);

/** A port as the form keeps it: digits only, five at most. */
export const portDigits = (typed: string): string => typed.replace(/\D/g, "").slice(0, 5);

/** Whether typed digits are a port a server can listen on. */
export const validPort = (digits: string): boolean =>
  /^\d{1,5}$/.test(digits) && Number(digits) >= 1 && Number(digits) <= 65535;

/** A system's name as the backend takes it: lowercase letters, digits and hyphens. */
export const systemName = (typed: string): string =>
  typed
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63);

/** Whether a self-hosted Twenty address is one the backend takes: https, or http on this machine. */
export function twentyAddress(typed: string): boolean {
  try {
    const url = new URL(typed.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local);
  } catch {
    return false;
  }
}
