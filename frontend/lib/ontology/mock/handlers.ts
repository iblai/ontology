import type {
  Agent,
  AgentConnection,
  BackendConfigSnapshot,
  ComplianceReport,
  Db,
  GraphData,
  GraphRecords,
  HealthSnapshot,
  McpSource,
  McpTool,
  McpToolset,
  ProvisioningRun,
  ProvisioningStep,
  Role,
  SafetyReport,
  Service,
  ServiceEndpoint,
  ServiceHealth,
  SyncRun,
  SyncSchedule,
  TableEdit,
  TermDetail,
} from "../types";
import { STEP_TYPES } from "../types";
import { AUTO_ONTOLOGY, CUSTOM_API } from "../connectable";
import { parseAllDocuments, stringify } from "yaml";
import { mutate, query, resetDb, uid, now, isoMinutesAgo } from "./store";
import {
  MOCK_READING,
  MOCK_TERMS,
  changesData,
  generatedTerm,
  mockGraph,
  mockRecords,
} from "./graph";
import { configFromTexts } from "../config-files";
import { accessLevel, type Tooling } from "../access";

type Ok = { ok: boolean; message: string };

/** The demo platform's agents; two share a name, as agents may. */
const AGENTS: Agent[] = [
  { id: "3f2a9c10-0000-4000-8000-000000000001", name: "Admissions assistant" },
  { id: "7b61e4d2-0000-4000-8000-000000000002", name: "Advising coach" },
  { id: "c05d8e77-0000-4000-8000-000000000003", name: "Advising coach" },
];

/** Upsert by `name`; the mock keeps insertion order like the YAML files do. */
function upsert<T extends { name: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.name === item.name);
  return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}

/** The tables Twenty fills, as the backend's catalog names them. */
const TWENTY_TABLES = [
  "persons",
  "organizations",
  "deals",
  "workspace_members",
  "notes",
  "tasks",
  "note_targets",
  "task_targets",
];

/** What Twenty's operations change, and what each sends, as the backend's catalog names them. */
const TWENTY_OBJECTS = ["person", "company", "opportunity", "note", "task"];
const TWENTY_OPERATIONS = [
  ["create", "POST", "Create"],
  ["update", "PATCH", "Update"],
] as const;

/** What deciding a role's tools needs, read from the mock's own tools. */
const tooling = (db: Db): Tooling => ({
  toolsets: db.mcp_toolsets,
  writing: new Set(db.mcp_tools.filter(changesData).map((t) => t.name)),
  known: new Set(db.mcp_tools.map((t) => t.name)),
});
/** As the backend: a tool that is gone, or that now changes data, leaves every role holding it by name. */
function dropTools(db: Db, tools: string[]) {
  db.roles = db.roles.map((r) =>
    r.mcp_tools?.some((t) => tools.includes(t))
      ? { ...r, mcp_tools: r.mcp_tools.filter((t) => !tools.includes(t)) }
      : r,
  );
}

/** A custom API's two toolsets, and its two sources of the same names: reads, then changes. */
const ownToolsets = (system: string) => [`${system}-reads`, `${system}-writes`];
/** A value in an endpoint's path: `{invoice_id}`. */
const PLACE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
/** An endpoint as the mock keeps it: a tool, with what the backend keeps in tools.yaml beside it. */
type EndpointTool = McpTool & { method: ServiceEndpoint["method"]; path: string };

function asEndpoint(system: string, tool: McpTool): ServiceEndpoint {
  const { method, path } = tool as EndpointTool;
  const values = [...path.matchAll(PLACE)].map((m) => m[1]);
  const names = tool.parameters.map((p) => p.name);
  return {
    name: tool.name.slice(system.length + 1),
    tool: tool.name,
    description: tool.description,
    method,
    path,
    query: names.filter((n) => n !== "body" && !values.includes(n)),
    body: names.includes("body"),
    write: method !== "GET",
  };
}

export const mockApi = {
  reset(): void {
    resetDb();
  },

  health: {
    all(): HealthSnapshot {
      return query((db) => ({
        ...db.health,
        checked_at: now(),
      }));
    },
    recheck(): HealthSnapshot {
      return mutate((db) => {
        db.health = { ...db.health, checked_at: now() };
        return db.health;
      });
    },
  },

  graph(columns: boolean): GraphData {
    return query((db) => mockGraph(db, columns));
  },
  graphRecords(domain: string, limit: number): GraphRecords {
    return query((db) => mockRecords(db, domain, limit));
  },

  services: {
    list(): Service[] {
      return query((db) => [...db.services]);
    },
    updateTables(name: string, body: TableEdit): Ok & { updated: number } {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        if (!svc) return { ok: false, message: "Service not found.", updated: 0 };
        const wanted = new Set(body.tables);
        let updated = 0;
        for (const t of svc.schema_manifest?.tables ?? []) {
          if (!wanted.has(`${t.schema_name}.${t.table_name}`)) continue;
          if (body.entity_group !== undefined) t.entity_group = body.entity_group;
          if (body.description !== undefined) t.description = body.description;
          updated++;
        }
        return { ok: true, message: `Updated ${updated} table(s).`, updated };
      });
    },
    get(name: string): Service | null {
      return query((db) => db.services.find((s) => s.name === name) ?? null);
    },
    runs(name: string): ProvisioningRun[] {
      return query((db) =>
        db.provisioning_runs
          .filter((r) => r.service_name === name)
          .sort((a, b) => b.started_at.localeCompare(a.started_at)),
      );
    },
    safetyReport(name: string): SafetyReport | undefined {
      return query((db) => db.safety_reports.find((r) => r.service_name === name));
    },
    status(name: string): ServiceHealth | null {
      return mutate((db) => {
        const existing = db.service_health.find((h) => h.service_name === name);
        const probe: ServiceHealth = {
          id: existing?.id ?? uid("sh_"),
          service_name: name,
          connected: name !== "snowflake",
          read_only: true,
          latency_ms: name === "snowflake" ? 0 : 35 + Math.floor(Math.random() * 30),
          checked_at: now(),
          detail: (name === "snowflake" ? { error: "Connection refused" } : { ok: true }) as Record<
            string,
            unknown
          >,
        };
        db.service_health = [...db.service_health.filter((h) => h.service_name !== name), probe];
        return probe;
      });
    },
    test(name: string): SafetyReport {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        const passed = svc?.safety_status === "passed";
        const dbType = svc?.schema_manifest?.db_type ?? "postgres";
        const tests = (
          [
            "CREATE TABLE",
            "INSERT",
            "UPDATE",
            "DELETE",
            "DROP TABLE",
            "ALTER TABLE",
            "TRUNCATE",
          ] as const
        ).map((test_name) => ({
          test_name,
          sql_attempted: `-- ${test_name} attempt on ${name}`,
          result: (passed ? "passed" : "failed") as "passed" | "failed",
          detail: passed
            ? "Write correctly denied by read-only account."
            : "Write succeeded — account is not read-only.",
        }));
        const report: SafetyReport = {
          service_name: name,
          db_type: dbType,
          host: svc?.host ?? "unknown",
          port: svc?.port ?? 0,
          database: svc?.database ?? "unknown",
          username: `${name}_readonly`,
          status: passed ? "passed" : "failed",
          tests_run: 7,
          tests_passed: passed ? 7 : 0,
          tests_failed: passed ? 0 : 7,
          details: tests,
          remediation_sql: passed
            ? undefined
            : `-- Revoke write privileges for ${name}_readonly:\nREVOKE CREATE, INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE ON SCHEMA public FROM ${name}_readonly;`,
          created_at: now(),
        };
        db.safety_reports = [...db.safety_reports.filter((r) => r.service_name !== name), report];
        if (svc) {
          svc.safety_status = passed ? "passed" : "failed";
          svc.last_safety_check_at = now();
        }
        return report;
      });
    },
    discover(name: string): { ok: boolean; message: string } {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        if (!svc) return { ok: false, message: "Service not found." };
        svc.last_discovery_at = now();
        // An Auto Ontology server is read again: its terms, not a schema.
        if (svc.adapter === AUTO_ONTOLOGY)
          return { ok: true, message: `${MOCK_READING.terms} terms read.` };
        return { ok: true, message: `Discovery re-run for ${name}.` };
      });
    },
    approve(name: string): { ok: boolean; runId?: string; message: string } {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        if (!svc) return { ok: false, message: "Service not found." };
        if (svc.safety_status !== "passed") {
          return { ok: false, message: "Safety suite must pass before approval." };
        }
        const runId = uid("run_");
        const stepTypes = STEP_TYPES;
        const steps: ProvisioningStep[] = stepTypes.map((step_type, i) => ({
          id: uid("step_"),
          run_id: runId,
          step_type,
          status: "completed",
          order: i,
          started_at: isoMinutesAgo(i * 2 + 1),
          completed_at: isoMinutesAgo(i * 2),
          output: (step_type === "docker_compose" && svc.service_type === "database"
            ? { skipped: "database service uses shared MCP Toolbox" }
            : { ok: true }) as Record<string, unknown>,
        }));
        const run: ProvisioningRun = {
          id: runId,
          service_name: name,
          status: "completed",
          started_at: isoMinutesAgo(12),
          completed_at: isoMinutesAgo(0),
          steps,
        };
        db.provisioning_runs = [run, ...db.provisioning_runs];
        svc.status = "active";
        return { ok: true, runId, message: "Pipeline completed." };
      });
    },
    sync(name: string): { ok: boolean; message: string } {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        if (!svc) return { ok: false, message: "Service not found." };
        const run: SyncRun = {
          id: uid("sr_"),
          schedule_name: `${name}-manual`,
          source_system: name,
          started_at: now(),
          completed_at: now(),
          status: "success",
          records_processed: 100 + Math.floor(Math.random() * 500),
          records_created: Math.floor(Math.random() * 20),
          records_updated: 50 + Math.floor(Math.random() * 200),
          duration_seconds: 30 + Math.floor(Math.random() * 60),
        };
        db.sync_runs = [run, ...db.sync_runs];
        svc.last_sync_at = now();
        svc.sync_status = "success";
        return { ok: true, message: "Sync started." };
      });
    },
    remove(name: string): { ok: boolean; message: string } {
      return mutate((db) => {
        db.services = db.services.filter((s) => s.name !== name);
        db.provisioning_runs = db.provisioning_runs.filter((r) => r.service_name !== name);
        db.safety_reports = db.safety_reports.filter((r) => r.service_name !== name);
        db.sync_schedules = db.sync_schedules.filter((s) => s.source !== name);
        // What connecting it gave goes with it: its toolsets from every role, its reach from its own.
        const own = ownToolsets(name);
        if (db.mcp_toolsets.some((t) => own.includes(t.name))) {
          db.mcp_toolsets = db.mcp_toolsets.filter((t) => !own.includes(t.name));
          // A custom API's endpoints and sources are its own, as Twenty's operations are.
          dropTools(
            db,
            db.mcp_tools.filter((t) => t.service === name).map((t) => t.name),
          );
          db.mcp_tools = db.mcp_tools.filter((t) => t.service !== name);
          db.mcp_sources = db.mcp_sources.filter((s) => !own.includes(s.name));
          db.roles = db.roles.flatMap((r) => {
            const left = { ...r, mcp_toolsets: r.mcp_toolsets.filter((t) => !own.includes(t)) };
            if (r.name !== name) return [left];
            // Its own tables and folders: the house's, or those under its name.
            const mine = TWENTY_TABLES.flatMap((t) => [t, `${name.replace(/-/g, "_")}_${t}`]);
            left.cache_tables = left.cache_tables.filter((t) => !mine.includes(t));
            left.memory_paths = left.memory_paths.filter(
              (p) => !mine.some((t) => p === `/ontology/${t}/**`),
            );
            const reaches =
              left.mcp_toolsets.length +
              left.cache_tables.length +
              left.memory_paths.length +
              (left.mcp_tools?.length ?? 0);
            // A role left reaching nothing is removed.
            return reaches || left.admin_dashboard ? [left] : [];
          });
        }
        return { ok: true, message: `${name} removed.` };
      });
    },
    add(input: {
      name: string;
      display_name?: string;
      service_type: "database" | "api";
      adapter: string;
      host: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      api_key?: string;
      options?: Record<string, string>;
      domain: string;
    }): { ok: boolean; message: string } {
      return mutate((db) => {
        const exists = db.services.some((s) => s.name === input.name);
        if (exists) return { ok: false, message: `Service '${input.name}' already exists.` };
        // Twenty's key is tried at once, so it needs no review: connected, and syncing.
        const twenty = input.adapter === "twenty_api";
        if (twenty && input.api_key === "wrong")
          return { ok: false, message: "Twenty refused the API key: Token invalid." };
        // A custom API is connected at once too: its endpoints are named afterwards.
        const custom = input.adapter === CUSTOM_API;
        // An Auto Ontology server is connected at once as well, and read for its terms.
        const terms = input.adapter === AUTO_ONTOLOGY;
        if ((custom || terms) && /^https?:\/\/localhost\b/.test(input.host))
          return {
            ok: false,
            message:
              "localhost is this machine or a link-local address (127.0.0.1): neither is called.",
          };
        // As the backend: a Twenty connected after another keeps its records in tables of its own.
        const prefix =
          twenty && db.services.some((s) => s.adapter === input.adapter)
            ? `${input.name.replace(/-/g, "_")}_`
            : "";
        const tables = TWENTY_TABLES.map((table) => prefix + table);
        const svc: Service = {
          name: input.name,
          display_name: input.display_name?.trim() || (twenty ? "Twenty CRM" : input.name),
          service_type: input.service_type,
          adapter: input.adapter,
          status: twenty || custom || terms ? "active" : "pending",
          host: input.host,
          port: input.port,
          database: input.database,
          connection_config: {
            host: input.host,
            ...(input.port !== undefined ? { port: String(input.port) } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.user ? { user: input.user } : {}),
            ...(input.password ? { password: "********" } : {}),
            ...(input.options?.header ? { header: input.options.header } : {}),
            ...(input.api_key ? { api_key: "********" } : {}),
          },
          // What a reading leaves on the system: how many terms, and in which of NVIDIA's databases.
          ...(terms
            ? {
                schema_manifest: {
                  db_type: "",
                  total_tables: 0,
                  total_rows: 0,
                  tables: [],
                  database: "",
                  ...MOCK_READING,
                },
              }
            : {}),
          safety_status: "pending",
          sync_status: twenty ? "running" : "never_run",
          tables_synced: 0,
          rows_synced: 0,
          domain: input.domain as Service["domain"],
          last_discovery_at: now(),
        };
        db.services = [...db.services, svc];
        if (twenty) {
          // As the backend: its operations are one toolset that changes data, and the role of its name reaches it.
          const writes = `${input.name}-writes`;
          const operations: McpTool[] = TWENTY_OPERATIONS.flatMap(([operation, method, verb]) =>
            TWENTY_OBJECTS.map((object) => ({
              kind: "tool" as const,
              name: `${input.name}-${operation}-${object}`,
              type: "twenty",
              source: "",
              service: input.name,
              method,
              description: `${verb} a ${object} in ${svc.display_name}.`,
              parameters: [],
            })),
          );
          for (const tool of operations) db.mcp_tools = upsert(db.mcp_tools, tool);
          db.mcp_toolsets = upsert(db.mcp_toolsets, {
            kind: "toolset",
            name: writes,
            tools: operations.map((t) => t.name),
            write: true,
          });
          const held = db.roles.find((r) => r.name === input.name);
          db.roles = upsert(db.roles, {
            name: input.name,
            display_name: svc.display_name,
            admin_dashboard: false,
            agents: [],
            ...held,
            mcp_toolsets: [...new Set([...(held?.mcp_toolsets ?? []), writes])],
            memory_paths: [
              ...new Set([
                ...(held?.memory_paths ?? []),
                ...tables.map((table) => `/ontology/${table}/**`),
              ]),
            ],
            cache_tables: [...new Set([...(held?.cache_tables ?? []), ...tables])],
          });
        }
        if (custom) {
          // As the backend: two sources, two empty toolsets, and the role of its name holds both.
          const [reads, writes] = ownToolsets(input.name);
          db.mcp_sources = [
            ...db.mcp_sources,
            { kind: "source", name: reads, type: "http" },
            { kind: "source", name: writes, type: "http" },
          ];
          db.mcp_toolsets = upsert(db.mcp_toolsets, { kind: "toolset", name: reads, tools: [] });
          db.mcp_toolsets = upsert(db.mcp_toolsets, {
            kind: "toolset",
            name: writes,
            tools: [],
            write: true,
          });
          const held = db.roles.find((r) => r.name === input.name);
          db.roles = upsert(db.roles, {
            name: input.name,
            display_name: svc.display_name,
            admin_dashboard: false,
            agents: [],
            memory_paths: [],
            cache_tables: [],
            ...held,
            mcp_toolsets: [...new Set([...(held?.mcp_toolsets ?? []), reads, writes])],
          });
        }
        const message = twenty
          ? `'${input.name}' is connected. Its records are on their way.`
          : custom
            ? `'${input.name}' is connected. Add the endpoints agents may call.`
            : terms
              ? `'${input.name}' is connected: ${MOCK_READING.terms} terms read.`
              : `${input.name} added. Discovery running.`;
        return { ok: true, message };
      });
    },
    /** As the backend: a term for each table that has none, written here from the table's name. */
    generateTerms(name: string): Ok {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        if (!svc) return { ok: false, message: `Service '${name}' not found.` };
        const tables = svc.schema_manifest?.tables ?? [];
        if (svc.service_type !== "database")
          return { ok: false, message: `'${name}' holds no tables to name.` };
        if (tables.length === 0)
          return { ok: false, message: `'${name}' has no tables yet: discover it first.` };
        const waiting = tables.filter((t) => !t.term);
        if (waiting.length === 0)
          return {
            ok: true,
            message: `Every one of its ${tables.length} tables has a term already.`,
          };
        for (const t of waiting) t.term = generatedTerm(t.table_name).name;
        return {
          ok: true,
          message: `${waiting.length} of its ${tables.length} tables got a term.`,
        };
      });
    },
    /** A term's columns and calculations: the mock's Auto Ontology server's, or a generated term's. */
    term(name: string, id: string): TermDetail {
      return query((db) => {
        // A term generated here: its columns under their plain names, from the tables that hold it.
        const held = db.services.find((s) => s.name === name && s.service_type === "database");
        if (held)
          return {
            ok: true,
            message: "",
            columns: (held.schema_manifest?.tables ?? [])
              .filter((t) => t.term && generatedTerm(t.table_name).id === id)
              .flatMap((t) =>
                generatedTerm(t.table_name).columns.map(([business, column]) => ({
                  name: business,
                  description: "",
                  certified: false,
                  table: t.table_name,
                  column,
                })),
              ),
            calculations: [],
          };
        const term = MOCK_TERMS.find((t) => t.id === id);
        if (!term || !db.services.some((s) => s.name === name && s.adapter === AUTO_ONTOLOGY))
          return {
            ok: false,
            message: `'${name}' holds no term ${id}.`,
            columns: [],
            calculations: [],
          };
        const certified = term.certification === "certified";
        return {
          ok: true,
          message: "",
          columns: term.columns.map(([business, column]) => ({
            name: business,
            description: "",
            certified,
            table: term.table,
            column,
          })),
          calculations: term.calculations.map(([calculation, expression]) => ({
            name: calculation,
            description: "",
            expression,
            certified,
          })),
        };
      });
    },
    /** A custom API's endpoints, read back from its tools as the backend reads them from tools.yaml. */
    endpoints(name: string): ServiceEndpoint[] {
      return query((db) =>
        db.mcp_tools
          .filter((t) => t.service === name && t.type === "http")
          .map((t) => asEndpoint(name, t)),
      );
    },
    saveEndpoint(name: string, input: Omit<ServiceEndpoint, "tool" | "write">): Ok {
      return mutate((db) => {
        if (!db.services.some((s) => s.name === name && s.adapter === CUSTOM_API))
          return { ok: false, message: `'${name}' is not a custom API.` };
        const tool = `${name}-${input.name}`;
        if (db.mcp_tools.some((t) => t.name === tool && t.service !== name))
          return {
            ok: false,
            message: `A tool named ${tool} exists already: name the endpoint something else.`,
          };
        if (!/^\/[A-Za-z0-9._~{}/-]+$/.test(input.path))
          return {
            ok: false,
            message:
              "A path starts with / and holds plain segments and {name} for a value: /invoices/{invoice_id}/notes",
          };
        // One that read and now changes data leaves every role that holds it by name.
        const before = db.mcp_tools.find((t) => t.name === tool);
        if (before && !changesData(before) && input.method !== "GET") dropTools(db, [tool]);
        const body = input.body && ["POST", "PUT", "PATCH"].includes(input.method);
        const values = [...input.path.matchAll(PLACE)].map((m) => m[1]);
        const home = ownToolsets(name)[input.method === "GET" ? 0 : 1];
        const entry: EndpointTool = {
          kind: "tool",
          name: tool,
          type: "http",
          source: home,
          service: name,
          description: input.description,
          method: input.method,
          path: input.path,
          parameters: [...new Set(values), ...input.query, ...(body ? ["body"] : [])].map((p) => ({
            name: p,
            type: p === "body" ? "map" : "string",
            description: p.replace(/_/g, " "),
          })),
        };
        db.mcp_tools = upsert(db.mcp_tools, entry);
        // It is listed in the toolset of its kind, and in that one alone.
        db.mcp_toolsets = db.mcp_toolsets.map((ts) =>
          ownToolsets(name).includes(ts.name)
            ? {
                ...ts,
                tools: [...ts.tools.filter((t) => t !== tool), ...(ts.name === home ? [tool] : [])],
              }
            : ts,
        );
        return { ok: true, message: `${tool} is saved: a role that holds ${home} can call it.` };
      });
    },
    removeEndpoint(name: string, endpoint: string): Ok {
      return mutate((db) => {
        const tool = `${name}-${endpoint}`;
        if (!db.mcp_tools.some((t) => t.name === tool && t.service === name))
          return { ok: false, message: `'${name}' has no endpoint named ${endpoint}.` };
        db.mcp_tools = db.mcp_tools.filter((t) => t.name !== tool);
        db.mcp_toolsets = db.mcp_toolsets.map((ts) =>
          ownToolsets(name).includes(ts.name)
            ? { ...ts, tools: ts.tools.filter((t) => t !== tool) }
            : ts,
        );
        dropTools(db, [tool]);
        return { ok: true, message: `${tool} is removed.` };
      });
    },
    /** A server whose login `wrong` is refused and any other may open three databases. */
    databases(login: { user: string; password: string }): Ok & { databases: string[] } {
      if (login.password === "wrong")
        return {
          ok: false,
          message: `password authentication failed for user "${login.user}"`,
          databases: [],
        };
      const databases = ["analytics", "crm", "warehouse"];
      return { ok: true, message: `${databases.length} database(s).`, databases };
    },
  },

  sync: {
    runAll(): { ok: boolean; message: string } {
      return mutate((db) => {
        const due = db.sync_schedules.filter((s) => s.enabled);
        for (const sched of due) {
          const run: SyncRun = {
            id: uid("sr_"),
            schedule_name: sched.name,
            source_system: sched.source,
            started_at: now(),
            completed_at: now(),
            status: "success",
            records_processed: 100 + Math.floor(Math.random() * 1000),
            records_created: Math.floor(Math.random() * 50),
            records_updated: 100 + Math.floor(Math.random() * 300),
            duration_seconds: 20 + Math.floor(Math.random() * 90),
          };
          db.sync_runs = [run, ...db.sync_runs];
        }
        return { ok: true, message: `Sync triggered for ${due.length} schedule(s).` };
      });
    },
    schedules() {
      return query((db) => [...db.sync_schedules]);
    },
    status(): SyncRun[] {
      return query((db) => {
        const latestBySchedule = new Map<string, SyncRun>();
        for (const r of db.sync_runs) {
          const existing = latestBySchedule.get(r.schedule_name);
          if (!existing || r.started_at > existing.started_at) {
            latestBySchedule.set(r.schedule_name, r);
          }
        }
        return [...latestBySchedule.values()].sort((a, b) =>
          a.schedule_name.localeCompare(b.schedule_name),
        );
      });
    },
    history(service?: string, limit = 20): SyncRun[] {
      return query((db) => {
        let runs = db.sync_runs;
        if (service && service !== "all") {
          runs = runs.filter((r) => r.source_system === service);
        }
        return runs.slice(0, limit);
      });
    },
    saveSchedule(schedule: SyncSchedule): Ok {
      return mutate((db) => {
        db.sync_schedules = upsert(db.sync_schedules, schedule);
        return { ok: true, message: `Schedule '${schedule.name}' saved.` };
      });
    },
    removeSchedule(name: string): Ok {
      return mutate((db) => {
        if (!db.sync_schedules.some((s) => s.name === name))
          return { ok: false, message: `Schedule '${name}' not found.` };
        db.sync_schedules = db.sync_schedules.filter((s) => s.name !== name);
        return { ok: true, message: `Schedule '${name}' removed.` };
      });
    },
  },

  mcp: {
    status() {
      return query((db) => db.health.gateway);
    },
    tools() {
      return query((db) => [...db.mcp_tools]);
    },
    toolsets() {
      return query((db) => [...db.mcp_toolsets]);
    },
    sources() {
      return query((db) => [...db.mcp_sources]);
    },
    validate(): ComplianceReport {
      return query((db) => ({
        sources: db.mcp_sources.length,
        tools: db.mcp_tools.length,
        toolsets: db.mcp_toolsets.length,
        issues: [],
      }));
    },
    build(): { ok: boolean; nativeTools: number; path: string } {
      return { ok: true, nativeTools: 6, path: "config/generated/toolbox.yaml" };
    },
    test(tool: string, params: Record<string, unknown>): { ok: boolean; result: unknown } {
      return {
        ok: true,
        result: {
          tool,
          params,
          rows: [
            {
              EMPLID: "001234567",
              NAME: "Doe, Jane",
              TERM: "2026 FALL",
              UNITS: 15,
              STATUS: "ENROLLED",
            },
            {
              EMPLID: "001234567",
              NAME: "Doe, Jane",
              TERM: "2026 SPR",
              UNITS: 12,
              STATUS: "COMPLETED",
            },
          ],
          executed_at: now(),
        },
      };
    },
    saveTool(tool: McpTool): Ok {
      return mutate((db) => {
        // A tool the gateway runs on its system itself names no source.
        if (tool.type !== "twenty" && !db.mcp_sources.some((s) => s.name === tool.source))
          return {
            ok: false,
            message: `tool '${tool.name}' references undefined source '${tool.source}'`,
          };
        db.mcp_tools = upsert(db.mcp_tools, tool);
        return {
          ok: true,
          message: `tool '${tool.name}' saved.`,
        };
      });
    },
    removeTool(name: string): Ok {
      return mutate((db) => {
        const user = db.mcp_toolsets.find((ts) => ts.tools.includes(name));
        if (user)
          return {
            ok: false,
            message: `toolset '${user.name}' references undefined tool '${name}'`,
          };
        if (!db.mcp_tools.some((t) => t.name === name))
          return { ok: false, message: `tool '${name}' not found.` };
        db.mcp_tools = db.mcp_tools.filter((t) => t.name !== name);
        dropTools(db, [name]);
        return {
          ok: true,
          message: `tool '${name}' removed.`,
        };
      });
    },
    saveToolset(toolset: McpToolset): Ok {
      return mutate((db) => {
        const missing = toolset.tools.find((t) => !db.mcp_tools.some((x) => x.name === t));
        if (missing)
          return {
            ok: false,
            message: `toolset '${toolset.name}' references undefined tool '${missing}'`,
          };
        // Like the backend's tools.yaml: `write` is left out unless it is set.
        const { write, ...rest } = toolset;
        db.mcp_toolsets = upsert(db.mcp_toolsets, write ? toolset : rest);
        return {
          ok: true,
          message: `toolset '${toolset.name}' saved.`,
        };
      });
    },
    removeToolset(name: string): Ok {
      return mutate((db) => {
        if (!db.mcp_toolsets.some((t) => t.name === name))
          return { ok: false, message: `toolset '${name}' not found.` };
        db.mcp_toolsets = db.mcp_toolsets.filter((t) => t.name !== name);
        return {
          ok: true,
          message: `toolset '${name}' removed.`,
        };
      });
    },
    saveSource(source: McpSource): Ok {
      return mutate((db) => {
        if (source.password && !/^\$\{[A-Z0-9_]+\}$/.test(source.password))
          return {
            ok: false,
            message: `source '${source.name}' has a literal 'password'; use a \${VAR} reference`,
          };
        db.mcp_sources = upsert(db.mcp_sources, source);
        return {
          ok: true,
          message: `source '${source.name}' saved.`,
        };
      });
    },
    removeSource(name: string): Ok {
      return mutate((db) => {
        const user = db.mcp_tools.find((t) => t.source === name);
        if (user)
          return {
            ok: false,
            message: `tool '${user.name}' references undefined source '${name}'`,
          };
        if (!db.mcp_sources.some((s) => s.name === name))
          return { ok: false, message: `source '${name}' not found.` };
        db.mcp_sources = db.mcp_sources.filter((s) => s.name !== name);
        return {
          ok: true,
          message: `source '${name}' removed.`,
        };
      });
    },
    config(): { text: string } {
      return query((db) => ({
        text: [...db.mcp_sources, ...db.mcp_tools, ...db.mcp_toolsets]
          .map((doc) => stringify(doc))
          .join("---\n"),
      }));
    },
    saveConfig(text: string): ComplianceReport {
      return mutate((db) => {
        const docs = parseAllDocuments(text);
        const issues: ComplianceReport["issues"] = [];
        for (const doc of docs) {
          for (const err of doc.errors) issues.push({ severity: "error", message: err.message });
        }
        const rejected = (counts: Partial<ComplianceReport>): ComplianceReport => ({
          ok: false,
          message: issues.map((i) => i.message).join("; "),
          sources: 0,
          tools: 0,
          toolsets: 0,
          ...counts,
          issues,
        });
        if (issues.length) return rejected({});
        const parsed = docs.map((d) => d.toJS() as Record<string, unknown> | null).filter(Boolean);
        const sources = parsed.filter((d) => d!.kind === "source") as unknown as McpSource[];
        const tools = parsed.filter((d) => d!.kind === "tool") as unknown as McpTool[];
        const toolsets = parsed.filter((d) => d!.kind === "toolset") as unknown as McpToolset[];
        const counts = { sources: sources.length, tools: tools.length, toolsets: toolsets.length };
        if (!text.trim())
          issues.push({ severity: "error", message: "tools.yaml must not be empty" });
        for (const t of tools)
          if (t.type !== "twenty" && !sources.some((s) => s.name === t.source))
            issues.push({
              severity: "error",
              message: `tool '${t.name}' references undefined source '${t.source}'`,
            });
        for (const ts of toolsets)
          for (const name of ts.tools ?? [])
            if (!tools.some((t) => t.name === name))
              issues.push({
                severity: "error",
                message: `toolset '${ts.name}' references undefined tool '${name}'`,
              });
        if (issues.length) return rejected(counts);
        db.mcp_sources = sources;
        db.mcp_tools = tools.map((t) => ({ ...t, parameters: t.parameters ?? [] }));
        db.mcp_toolsets = toolsets;
        return {
          ok: true,
          message: "tools.yaml saved.",
          ...counts,
          issues: [],
        };
      });
    },
  },

  roles: {
    /** Each role with the tools it holds by name and how far it reaches, as the backend sends it. */
    list(): Role[] {
      return query((db) => {
        const known = tooling(db);
        return db.roles.map((r) => ({
          ...r,
          mcp_tools: r.mcp_tools ?? [],
          access: accessLevel(r, known),
        }));
      });
    },
    save(role: Role): Ok {
      return mutate((db) => {
        const bad = role.mcp_toolsets.find(
          (t) => t !== "*" && !db.mcp_toolsets.some((x) => x.name === t),
        );
        if (bad) return { ok: false, message: `Unknown toolsets: ${bad}` };
        // A tool is held by a name the gateway knows; one the role held before may stay.
        const before = db.roles.find((r) => r.name === role.name)?.mcp_tools ?? [];
        const unknown = (role.mcp_tools ?? before).find(
          (t) => !db.mcp_tools.some((x) => x.name === t) && !before.includes(t),
        );
        if (unknown) return { ok: false, message: `Unknown tools: ${unknown}` };
        // How far it reaches is worked out, never kept; a save that names no tools keeps them.
        const { access: _level, ...kept } = role;
        db.roles = upsert(db.roles, { ...kept, mcp_tools: role.mcp_tools ?? before });
        return { ok: true, message: `Role '${role.name}' saved.` };
      });
    },
    remove(name: string): Ok {
      return mutate((db) => {
        if (name === "default")
          return { ok: false, message: "The default role is the fallback and cannot be deleted." };
        if (!db.roles.some((r) => r.name === name))
          return { ok: false, message: `Role '${name}' not found.` };
        db.roles = db.roles.filter((r) => r.name !== name);
        return { ok: true, message: `Role '${name}' removed.` };
      });
    },
  },

  config: {
    /** The backend's config files as the Configuration page shows them, rendered from the mock state. */
    snapshot(): BackendConfigSnapshot {
      return query((db) => {
        const groups = new Set<string>();
        for (const s of db.services)
          for (const t of s.schema_manifest?.tables ?? [])
            if (t.entity_group) groups.add(t.entity_group);
        return configFromTexts("mock", {
          ontology: stringify({ entity_groups: [...groups].sort() }),
          schedules: stringify({ schedules: db.sync_schedules }),
          roles: stringify({
            roles: Object.fromEntries(db.roles.map(({ name, ...r }) => [name, r])),
          }),
          tools: mockApi.mcp.config().text,
        });
      });
    },
  },

  agents: {
    list(): Ok & { agents: Agent[] } {
      return { ok: true, message: "", agents: AGENTS };
    },
    connections(): AgentConnection[] {
      return query((db) => [...db.agent_connections]);
    },
    connect(input: { agent: string; role: string }): Ok {
      return mutate((db) => {
        const agent = AGENTS.find((a) => a.id === input.agent);
        if (!agent) return { ok: false, message: "That agent is not one of this platform's." };
        if (!db.roles.some((r) => r.name === input.role))
          return { ok: false, message: `Role '${input.role}' reaches nothing yet.` };
        const name = `${agent.id.slice(0, 8)}-${input.role.toLowerCase()}`;
        if (db.agent_connections.some((c) => c.name === name))
          return {
            ok: false,
            message: `${agent.name} is already connected as ${input.role}. Remove that connection first.`,
          };
        db.agent_connections = [
          {
            name,
            agent: agent.id,
            agent_name: agent.name,
            role: input.role,
            fingerprint: uid().padEnd(12, "0"),
            created_at: now(),
            created_by: "demo",
          },
          ...db.agent_connections,
        ];
        return { ok: true, message: `${agent.name} is connected as ${input.role}.` };
      });
    },
    disconnect(name: string): Ok {
      return mutate((db) => {
        if (!db.agent_connections.some((c) => c.name === name))
          return { ok: false, message: `No connection named '${name}'.` };
        db.agent_connections = db.agent_connections.filter((c) => c.name !== name);
        return { ok: true, message: "The connection is removed and its key deleted." };
      });
    },
  },

  counts() {
    return query((db) => ({
      services: db.services.length,
      tools: db.mcp_tools.length,
      toolsets: db.mcp_toolsets.length,
      roles: db.roles.length,
      data_store: "local" as const,
      platform: "",
    }));
  },
};
