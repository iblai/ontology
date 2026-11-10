import type {
  BackendConfigSnapshot,
  ComplianceReport,
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
  ServiceHealth,
  SyncRun,
  SyncSchedule,
  TableEdit,
} from "../types";
import { STEP_TYPES } from "../types";
import { parseAllDocuments, stringify } from "yaml";
import { mutate, query, resetDb, uid, now, isoMinutesAgo } from "./store";
import { mockGraph, mockRecords } from "./graph";
import { configFromTexts } from "../config-files";

type Ok = { ok: boolean; message: string };

/** Upsert by `name`; the mock keeps insertion order like the YAML files do. */
function upsert<T extends { name: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.name === item.name);
  return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
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
        return { ok: true, message: `${name} removed.` };
      });
    },
    add(input: {
      name: string;
      service_type: "database" | "api";
      adapter: string;
      host: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      domain: string;
    }): { ok: boolean; message: string } {
      return mutate((db) => {
        const exists = db.services.some((s) => s.name === input.name);
        if (exists) return { ok: false, message: `Service '${input.name}' already exists.` };
        const svc: Service = {
          name: input.name,
          display_name: input.name,
          service_type: input.service_type,
          adapter: input.adapter,
          status: "pending",
          host: input.host,
          port: input.port,
          database: input.database,
          connection_config: {
            host: input.host,
            ...(input.port !== undefined ? { port: String(input.port) } : {}),
            ...(input.database ? { database: input.database } : {}),
            ...(input.user ? { user: input.user } : {}),
            ...(input.password ? { password: input.password } : {}),
          },
          safety_status: "pending",
          sync_status: "never_run",
          tables_synced: 0,
          rows_synced: 0,
          domain: input.domain as Service["domain"],
          last_discovery_at: now(),
        };
        db.services = [...db.services, svc];
        return { ok: true, message: `${input.name} added. Discovery running.` };
      });
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
        issues: [
          {
            severity: "warning" as const,
            message:
              "Tool 'get-canvas-activity' references source 'peoplesoft-db' (database) but is type 'http'. Consider a dedicated API source.",
          },
        ],
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
        if (!db.mcp_sources.some((s) => s.name === tool.source))
          return {
            ok: false,
            message: `tool '${tool.name}' references undefined source '${tool.source}'`,
          };
        db.mcp_tools = upsert(db.mcp_tools, tool);
        return {
          ok: true,
          message: `tool '${tool.name}' saved. Build and restart the MCP Toolbox to apply.`,
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
        return {
          ok: true,
          message: `tool '${name}' removed. Build and restart the MCP Toolbox to apply.`,
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
        db.mcp_toolsets = upsert(db.mcp_toolsets, toolset);
        return {
          ok: true,
          message: `toolset '${toolset.name}' saved. Build and restart the MCP Toolbox to apply.`,
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
          message: `toolset '${name}' removed. Build and restart the MCP Toolbox to apply.`,
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
          message: `source '${source.name}' saved. Build and restart the MCP Toolbox to apply.`,
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
          message: `source '${name}' removed. Build and restart the MCP Toolbox to apply.`,
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
          if (!sources.some((s) => s.name === t.source))
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
          message: "tools.yaml saved. Build and restart the MCP Toolbox to apply.",
          ...counts,
          issues: [],
        };
      });
    },
  },

  roles: {
    list() {
      return query((db) => [...db.roles]);
    },
    save(role: Role): Ok {
      return mutate((db) => {
        const bad = role.mcp_toolsets.find(
          (t) => t !== "*" && !db.mcp_toolsets.some((x) => x.name === t),
        );
        if (bad) return { ok: false, message: `Unknown toolsets: ${bad}` };
        db.roles = upsert(db.roles, role);
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

  counts() {
    return query((db) => ({
      services: db.services.length,
      tools: db.mcp_tools.length,
      toolsets: db.mcp_toolsets.length,
      roles: db.roles.length,
      data_store: "local" as const,
    }));
  },
};
