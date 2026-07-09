import type {
  Service,
  ProvisioningRun,
  ProvisioningStep,
  SyncRun,
  ServiceHealth,
  SafetyReport,
  HealthSnapshot,
  ComplianceReport,
} from "../types";
import { STEP_TYPES } from "../types";
import { mutate, query, resetDb, uid, now, isoMinutesAgo } from "./store";

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

  services: {
    list(): Service[] {
      return query((db) => [...db.services]);
    },
    get(name: string): Service | null {
      return query((db) => db.services.find((s) => s.name === name) ?? null);
    },
    runs(name: string): ProvisioningRun[] {
      return query((db) =>
        db.provisioning_runs.filter((r) => r.service_name === name).sort((a, b) => b.started_at.localeCompare(a.started_at)),
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
          detail: (name === "snowflake" ? { error: "Connection refused" } : { ok: true }) as Record<string, unknown>,
        };
        db.service_health = [
          ...db.service_health.filter((h) => h.service_name !== name),
          probe,
        ];
        return probe;
      });
    },
    test(name: string): SafetyReport {
      return mutate((db) => {
        const svc = db.services.find((s) => s.name === name);
        const passed = svc?.safety_status === "passed";
        const dbType = svc?.schema_manifest?.db_type ?? "postgres";
        const tests = ([
          "CREATE TABLE",
          "INSERT",
          "UPDATE",
          "DELETE",
          "DROP TABLE",
          "ALTER TABLE",
          "TRUNCATE",
        ] as const).map((test_name) => ({
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
        db.safety_reports = [
          ...db.safety_reports.filter((r) => r.service_name !== name),
          report,
        ];
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
          output:
            (step_type === "docker_compose" && svc.service_type === "database"
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
        return [...latestBySchedule.values()].sort((a, b) => a.schedule_name.localeCompare(b.schedule_name));
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
            message: "Tool 'get-canvas-activity' references source 'peoplesoft-db' (database) but is type 'http'. Consider a dedicated API source.",
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
            { EMPLID: "001234567", NAME: "Doe, Jane", TERM: "2026 FALL", UNITS: 15, STATUS: "ENROLLED" },
            { EMPLID: "001234567", NAME: "Doe, Jane", TERM: "2026 SPR", UNITS: 12, STATUS: "COMPLETED" },
          ],
          executed_at: now(),
        },
      };
    },
  },

  roles: {
    list() {
      return query((db) => [...db.roles]);
    },
  },

  counts() {
    return query((db) => ({
      services: db.services.length,
      tools: db.mcp_tools.length,
      toolsets: db.mcp_toolsets.length,
      roles: db.roles.length,
    }));
  },
};