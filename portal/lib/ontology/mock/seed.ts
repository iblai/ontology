import type {
  Db,
  Service,
  ProvisioningRun,
  ProvisioningStep,
  SyncRun,
  McpTool,
  McpToolset,
  McpSource,
  Role,
  HealthSnapshot,
  SafetyReport,
  ServiceHealth,
  SyncSchedule,
} from "../types";
import { isoHoursAgo, isoDaysAgo, isoMinutesAgo, uid } from "./store";

function peopleSoftManifest() {
  const tables = [
    { schema_name: "SYSADM", table_name: "PS_STDNT_CAR_TERM", row_count: 2_345_678, column_count: 24 },
    { schema_name: "SYSADM", table_name: "PS_STDNT_ENRL", row_count: 1_876_543, column_count: 31 },
    { schema_name: "SYSADM", table_name: "PS_FIN_AID_AWD", row_count: 987_654, column_count: 18 },
    { schema_name: "SYSADM", table_name: "PS_CLASS_TBL", row_count: 543_210, column_count: 42 },
    { schema_name: "SYSADM", table_name: "PS_STDNT_BIO", row_count: 432_109, column_count: 27 },
    { schema_name: "SYSADM", table_name: "PS_INSTITUTION", row_count: 12, column_count: 15 },
  ];
  return {
    db_type: "oracle",
    total_tables: 847,
    total_rows: 12_400_000,
    tables,
  };
}

function canvasManifest() {
  const tables = [
    { schema_name: "public", table_name: "enrollments", row_count: 89_432, column_count: 12 },
    { schema_name: "public", table_name: "submissions", row_count: 234_871, column_count: 9 },
    { schema_name: "public", table_name: "courses", row_count: 1_204, column_count: 14 },
    { schema_name: "public", table_name: "users", row_count: 45_678, column_count: 8 },
    { schema_name: "public", table_name: "assignments", row_count: 12_098, column_count: 11 },
  ];
  return {
    db_type: "postgres",
    total_tables: 38,
    total_rows: 383_283,
    tables,
  };
}

function slateManifest() {
  const tables = [
    { schema_name: "slate", table_name: "applications", row_count: 14_567, column_count: 22 },
    { schema_name: "slate", table_name: "prospects", row_count: 28_901, column_count: 16 },
    { schema_name: "slate", table_name: "decisions", row_count: 8_765, column_count: 11 },
  ];
  return {
    db_type: "postgres",
    total_tables: 19,
    total_rows: 52_233,
    tables,
  };
}

function snowflakeManifest() {
  const tables = [
    { schema_name: "SALES", table_name: "ORDERS", row_count: 5_432_109, column_count: 28 },
    { schema_name: "SALES", table_name: "CUSTOMERS", row_count: 1_098_765, column_count: 19 },
    { schema_name: "HR", table_name: "EMPLOYEES", row_count: 23_456, column_count: 23 },
    { schema_name: "FINANCE", table_name: "LEDGER", row_count: 18_765_432, column_count: 31 },
  ];
  return {
    db_type: "snowflake",
    total_tables: 124,
    total_rows: 25_317_762,
    tables,
  };
}

function buildSafetyReport(serviceName: string, dbType: string, passed: boolean): SafetyReport {
  const tests = ([
    "CREATE TABLE",
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP TABLE",
    "ALTER TABLE",
    "TRUNCATE",
  ] as const).map((name) => ({
    test_name: name,
    sql_attempted: `-- ${name} attempt on ${serviceName}`,
    result: (passed ? "passed" : name === "DROP TABLE" ? "failed" : "passed") as
      | "passed"
      | "failed"
      | "error",
    detail: passed
      ? "Write correctly denied by read-only account."
      : "Write succeeded — account is not read-only.",
  }));
  return {
    service_name: serviceName,
    db_type: dbType,
    host: serviceName === "peoplesoft" ? "psft-db.internal.edu" : "db.internal",
    port: serviceName === "peoplesoft" ? 1521 : 5432,
    database: serviceName === "peoplesoft" ? "CSPRD" : serviceName,
    username: `${serviceName}_readonly`,
    status: passed ? "passed" : "failed",
    tests_run: 7,
    tests_passed: passed ? 7 : 6,
    tests_failed: passed ? 0 : 1,
    details: tests,
    remediation_sql: passed
      ? undefined
      : `-- Revoke write privileges for ${serviceName}_readonly:\nREVOKE CREATE, INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE ON SCHEMA public FROM ${serviceName}_readonly;`,
    created_at: isoHoursAgo(20),
  };
}

function buildProvisioningRun(
  serviceName: string,
  status: "completed" | "failed" | "running",
  failAtStep?: number,
): ProvisioningRun {
  const stepTypes = [
    "cache_schema",
    "text_templates",
    "mcp_tools",
    "sync_schedules",
    "docker_compose",
    "validation",
  ] as const;
  const runId = uid("run_");
  const startedAt = isoDaysAgo(2);
  const steps: ProvisioningStep[] = stepTypes.map((step_type, i) => {
    let stepStatus: ProvisioningStep["status"];
    if (status === "completed") {
      stepStatus = step_type === "docker_compose" && serviceName === "peoplesoft" ? "skipped" : "completed";
    } else if (status === "running") {
      stepStatus = i < 2 ? "completed" : i === 2 ? "running" : "pending";
    } else {
      if (failAtStep === undefined) stepStatus = "completed";
      else if (i < failAtStep) stepStatus = "completed";
      else if (i === failAtStep) stepStatus = "failed";
      else stepStatus = "pending";
    }
    return {
      id: uid("step_"),
      run_id: runId,
      step_type,
      status: stepStatus,
      order: i,
      started_at: stepStatus === "pending" ? undefined : isoHoursAgo(48 - i * 2),
      completed_at:
        stepStatus === "completed" || stepStatus === "skipped" || stepStatus === "failed"
          ? isoHoursAgo(47 - i * 2)
          : undefined,
      output:
        stepStatus === "completed"
          ? ({ ok: true } as Record<string, unknown>)
          : stepStatus === "skipped"
            ? ({ skipped: "database service uses shared MCP Toolbox" } as Record<string, unknown>)
            : stepStatus === "failed"
              ? ({ error: `Failed during ${step_type}: permission denied` } as Record<string, unknown>)
              : undefined,
      error_message: stepStatus === "failed" ? "Permission denied during operation." : undefined,
    };
  });
  return {
    id: runId,
    service_name: serviceName,
    status,
    started_at: startedAt,
    completed_at:
      status === "completed" ? isoHoursAgo(43) : status === "failed" ? isoHoursAgo(43) : undefined,
    error_message: status === "failed" ? `Pipeline failed at step ${stepTypes[failAtStep ?? 0]}.` : undefined,
    steps,
  };
}

function buildServices(): Service[] {
  return [
    {
      name: "peoplesoft",
      display_name: "PeopleSoft (Oracle)",
      service_type: "database",
      adapter: "peoplesoft",
      status: "active",
      host: "psft-db.internal.edu",
      port: 1521,
      database: "CSPRD",
      connection_config: {
        host: "psft-db.internal.edu",
        port: "1521",
        database: "CSPRD",
        user: "iblai_readonly",
        password: "REDACTED_SECRET_VALUE",
      },
      schema_manifest: peopleSoftManifest(),
      llm_analysis: { provider: "anthropic", model: "claude-opus-4-8", entities: 42 },
      last_discovery_at: isoDaysAgo(2),
      last_safety_check_at: isoHoursAgo(20),
      safety_status: "passed",
      last_sync_at: isoMinutesAgo(45),
      sync_status: "success",
      tables_synced: 847,
      rows_synced: 12_400_000,
      domain: "higher-ed",
    },
    {
      name: "canvas",
      display_name: "Instructure Canvas LMS",
      service_type: "api",
      adapter: "canvas_api",
      status: "active",
      host: "canvas.instructure.com",
      connection_config: {
        base_url: "https://canvas.instructure.com",
        api_token: "REDACTED_SECRET_VALUE",
      },
      schema_manifest: canvasManifest(),
      llm_analysis: { provider: "rule-based", entities: 8 },
      last_discovery_at: isoDaysAgo(5),
      last_safety_check_at: isoDaysAgo(5),
      safety_status: "passed",
      last_sync_at: isoHoursAgo(2),
      sync_status: "success",
      tables_synced: 38,
      rows_synced: 383_283,
      domain: "higher-ed",
    },
    {
      name: "slate",
      display_name: "Technolutions Slate CRM",
      service_type: "api",
      adapter: "slate_api",
      status: "pending",
      host: "slate.alasu.edu",
      connection_config: {
        base_url: "https://slate.alasu.edu",
        api_key: "REDACTED_SECRET_VALUE",
      },
      schema_manifest: slateManifest(),
      llm_analysis: { provider: "rule-based", entities: 4 },
      last_discovery_at: isoDaysAgo(1),
      last_safety_check_at: isoDaysAgo(1),
      safety_status: "passed",
      last_sync_at: undefined,
      sync_status: "never_run",
      tables_synced: 0,
      rows_synced: 0,
      domain: "higher-ed",
    },
    {
      name: "snowflake",
      display_name: "Snowflake Data Warehouse",
      service_type: "database",
      adapter: "snowflake",
      status: "error",
      host: "xy12345.us-east-1.snowflakecomputing.com",
      connection_config: {
        account: "xy12345",
        user: "iblai_readonly",
        password: "REDACTED_SECRET_VALUE",
        warehouse: "ANALYTICS_WH",
      },
      schema_manifest: snowflakeManifest(),
      llm_analysis: { provider: "anthropic", model: "claude-opus-4-8", entities: 6 },
      last_discovery_at: isoDaysAgo(3),
      last_safety_check_at: isoDaysAgo(3),
      safety_status: "failed",
      last_sync_at: isoHoursAgo(18),
      sync_status: "failed",
      tables_synced: 0,
      rows_synced: 0,
      domain: "enterprise",
    },
  ];
}

function buildSyncSchedules(): SyncSchedule[] {
  return [
    {
      name: "peoplesoft-students",
      cron: "0 * * * *",
      source: "peoplesoft",
      tool: "get-student-enrollment",
      mode: "delta",
      description: "Sync student enrollment every hour",
      enabled: true,
    },
    {
      name: "peoplesoft-courses",
      cron: "0 */6 * * *",
      source: "peoplesoft",
      tool: "get-course-catalog",
      mode: "delta",
      description: "Refresh course catalog every 6 hours",
      enabled: true,
    },
    {
      name: "peoplesoft-financial-aid",
      cron: "0 * * * *",
      source: "peoplesoft",
      tool: "get-financial-aid",
      mode: "delta",
      description: "Sync financial aid awards hourly",
      enabled: true,
    },
    {
      name: "canvas-activity",
      cron: "0 */4 * * *",
      source: "canvas",
      tool: "get-canvas-activity",
      mode: "delta",
      description: "Pull Canvas activity every 4 hours",
      enabled: true,
    },
    {
      name: "canvas-submissions",
      cron: "0 * * * *",
      source: "canvas",
      tool: "get-canvas-submissions",
      mode: "delta",
      description: "Sync submissions hourly",
      enabled: true,
    },
    {
      name: "slate-applications",
      cron: "0 */6 * * *",
      source: "slate",
      tool: "get-applications",
      mode: "full",
      description: "Full refresh of Slate applications every 6 hours",
      enabled: false,
    },
  ];
}

function buildSyncRuns(): SyncRun[] {
  return [
    {
      id: uid("sr_"),
      schedule_name: "peoplesoft-students",
      source_system: "peoplesoft",
      started_at: isoMinutesAgo(45),
      completed_at: isoMinutesAgo(43),
      status: "success",
      records_processed: 1247,
      records_created: 12,
      records_updated: 1235,
      duration_seconds: 95,
    },
    {
      id: uid("sr_"),
      schedule_name: "peoplesoft-financial-aid",
      source_system: "peoplesoft",
      started_at: isoMinutesAgo(50),
      completed_at: isoMinutesAgo(48),
      status: "success",
      records_processed: 89,
      records_created: 3,
      records_updated: 86,
      duration_seconds: 42,
    },
    {
      id: uid("sr_"),
      schedule_name: "canvas-activity",
      source_system: "canvas",
      started_at: isoHoursAgo(2),
      completed_at: isoHoursAgo(2),
      status: "success",
      records_processed: 4521,
      records_created: 1024,
      records_updated: 3497,
      duration_seconds: 180,
    },
    {
      id: uid("sr_"),
      schedule_name: "peoplesoft-courses",
      source_system: "peoplesoft",
      started_at: isoHoursAgo(6),
      completed_at: isoHoursAgo(6),
      status: "success",
      records_processed: 432,
      records_created: 0,
      records_updated: 432,
      duration_seconds: 28,
    },
    {
      id: uid("sr_"),
      schedule_name: "canvas-submissions",
      source_system: "canvas",
      started_at: isoHoursAgo(1),
      completed_at: isoHoursAgo(1),
      status: "failed",
      records_processed: 0,
      records_created: 0,
      records_updated: 0,
      error_message: "Connection timeout to canvas.instructure.com",
      duration_seconds: 30,
    },
    {
      id: uid("sr_"),
      schedule_name: "peoplesoft-students",
      source_system: "peoplesoft",
      started_at: isoHoursAgo(3),
      completed_at: isoHoursAgo(3),
      status: "success",
      records_processed: 1198,
      records_created: 8,
      records_updated: 1190,
      duration_seconds: 88,
    },
  ];
}

function buildMcpSources(): McpSource[] {
  return [
    {
      kind: "source",
      name: "peoplesoft-db",
      type: "oracle",
      host: "psft-db.internal.edu",
      port: 1521,
      database: "CSPRD",
      user: "iblai_readonly",
      password: "${PEOPLESOFT_RO_PASSWORD}",
    },
    {
      kind: "source",
      name: "snowflake-wh",
      type: "snowflake",
      host: "xy12345.us-east-1.snowflakecomputing.com",
      database: "ANALYTICS",
      user: "iblai_readonly",
      password: "${SNOWFLAKE_PASSWORD}",
    },
  ];
}

function buildMcpTools(): McpTool[] {
  return [
    {
      kind: "tool",
      name: "get-student-enrollment",
      type: "oracle-sql",
      source: "peoplesoft-db",
      description: "Get enrollment records for a student by EMPLID",
      parameters: [
        { name: "student_id", type: "string", description: "The EMPLID of the student", required: true },
        { name: "term", type: "string", description: "Optional term code (e.g. 2026 FALL)", required: false },
      ],
      statement:
        "SELECT * FROM SYSADM.PS_STDNT_ENRL WHERE EMPLID = :student_id AND (:term IS NULL OR STRM = :term)",
    },
    {
      kind: "tool",
      name: "get-financial-aid",
      type: "oracle-sql",
      source: "peoplesoft-db",
      description: "Get financial aid awards for a student by EMPLID",
      parameters: [
        { name: "student_id", type: "string", description: "The EMPLID of the student", required: true },
        { name: "aid_year", type: "string", description: "Optional aid year (e.g. 2026)", required: false },
      ],
      statement: "SELECT * FROM SYSADM.PS_FIN_AID_AWD WHERE EMPLID = :student_id",
    },
    {
      kind: "tool",
      name: "get-course-catalog",
      type: "oracle-sql",
      source: "peoplesoft-db",
      description: "List the active course catalog",
      parameters: [{ name: "limit", type: "integer", description: "Max results", required: false }],
      statement: "SELECT * FROM SYSADM.PS_CLASS_TBL WHERE ROWNUM <= :limit",
    },
    {
      kind: "tool",
      name: "get-canvas-activity",
      type: "http",
      source: "peoplesoft-db",
      description: "Get recent Canvas activity events for a course",
      parameters: [
        { name: "course_id", type: "string", description: "Canvas course ID", required: true },
        { name: "since", type: "string", description: "ISO timestamp", required: false },
      ],
    },
    {
      kind: "tool",
      name: "get-canvas-submissions",
      type: "http",
      source: "peoplesoft-db",
      description: "List submissions for a Canvas assignment",
      parameters: [
        { name: "course_id", type: "string", description: "Canvas course ID", required: true },
        { name: "assignment_id", type: "string", description: "Assignment ID", required: true },
      ],
    },
    {
      kind: "tool",
      name: "get-applications",
      type: "http",
      source: "peoplesoft-db",
      description: "List Slate applications with optional status filter",
      parameters: [
        { name: "status", type: "string", description: "Application status (e.g. admitted)", required: false },
        { name: "limit", type: "integer", description: "Max results", required: false },
      ],
    },
    {
      kind: "tool",
      name: "get-snowflake-orders",
      type: "snowflake-sql",
      source: "snowflake-wh",
      description: "Query recent orders from the Snowflake sales schema",
      parameters: [
        { name: "customer_id", type: "string", description: "Customer ID", required: false },
        { name: "limit", type: "integer", description: "Max results", required: false },
      ],
      statement: "SELECT * FROM SALES.ORDERS WHERE (:customer_id IS NULL OR CUSTOMER_ID = :customer_id) LIMIT :limit",
    },
    {
      kind: "tool",
      name: "get-snowflake-ledger",
      type: "snowflake-sql",
      source: "snowflake-wh",
      description: "Query the finance ledger",
      parameters: [{ name: "limit", type: "integer", description: "Max results", required: false }],
      statement: "SELECT * FROM FINANCE.LEDGER LIMIT :limit",
    },
  ];
}

function buildMcpToolsets(): McpToolset[] {
  return [
    {
      kind: "toolset",
      name: "enrollment-tools",
      tools: ["get-student-enrollment", "get-financial-aid", "get-course-catalog"],
    },
    {
      kind: "toolset",
      name: "canvas-tools",
      tools: ["get-canvas-activity", "get-canvas-submissions"],
    },
    {
      kind: "toolset",
      name: "admissions-tools",
      tools: ["get-applications", "get-student-enrollment"],
    },
    {
      kind: "toolset",
      name: "admin-analytics-tools",
      tools: ["get-snowflake-orders", "get-snowflake-ledger"],
    },
  ];
}

function buildRoles(): Role[] {
  return [
    {
      name: "FinancialAidCounselor",
      display_name: "Financial Aid Counselor",
      mcp_toolsets: ["enrollment-tools"],
      memory_paths: ["/ontology/financial-aid/**", "/ontology/students/by-id/${USER_EMPLID}.md"],
      cache_tables: ["financial_aid", "students", "isir_data"],
      admin_dashboard: false,
      agents: ["general-info-agent"],
    },
    {
      name: "AcademicAdvisor",
      display_name: "Academic Advisor",
      mcp_toolsets: ["enrollment-tools"],
      memory_paths: ["/ontology/students/**", "/ontology/enrollment/**", "/ontology/courses/**"],
      cache_tables: ["students", "enrollment", "courses", "advising"],
      admin_dashboard: false,
      agents: ["general-info-agent", "analytics-agent"],
    },
    {
      name: "Registrar",
      display_name: "Registrar",
      mcp_toolsets: ["enrollment-tools", "admissions-tools"],
      memory_paths: ["/ontology/**"],
      cache_tables: ["*"],
      admin_dashboard: true,
      agents: ["general-info-agent", "analytics-agent"],
    },
    {
      name: "Student",
      display_name: "Student",
      mcp_toolsets: ["enrollment-tools"],
      memory_paths: ["/ontology/students/by-id/${USER_EMPLID}.md", "/ontology/courses/**"],
      cache_tables: ["students", "enrollment", "courses"],
      admin_dashboard: false,
      agents: [],
    },
    {
      name: "IblaiOntologyAdmin",
      display_name: "iblai/ontology Administrator",
      mcp_toolsets: ["*"],
      memory_paths: ["/ontology/**"],
      cache_tables: ["*"],
      admin_dashboard: true,
      agents: ["executive-dashboard-agent"],
    },
  ];
}

function buildHealth(): HealthSnapshot {
  return {
    db: {
      healthy: true,
      table_count: 18,
      total_rows: 13_245_678,
      size_mb: 4287.4,
      active_connections: 12,
    },
    mcp_servers: [
      { name: "mcp-toolbox", reachable: true, latency_ms: 42, tool_count: 6 },
      { name: "mcp-canvas", reachable: true, latency_ms: 88, tool_count: 2 },
      { name: "mcp-slate", reachable: false, latency_ms: 0, tool_count: 1 },
    ],
    sync: {
      running: true,
      total_schedules: 6,
      failed_last_24h: 1,
      next_due_schedule: "peoplesoft-students",
      next_due_at: isoMinutesAgo(-15),
    },
    storage: {
      total_files: 247,
      total_size_mb: 18.3,
      by_domain: [
        { domain: "students", files: 89, size_mb: 6.2 },
        { domain: "courses", files: 34, size_mb: 2.1 },
        { domain: "financial-aid", files: 67, size_mb: 4.8 },
        { domain: "enrollment", files: 28, size_mb: 1.9 },
        { domain: "hr", files: 12, size_mb: 0.8 },
        { domain: "facilities", files: 9, size_mb: 0.4 },
        { domain: "_audit", files: 5, size_mb: 1.2 },
        { domain: "_schema", files: 3, size_mb: 0.9 },
      ],
    },
    gateway: {
      running: true,
      url: "https://ontology.alasu.edu/mcp",
      tool_count: 8,
      toolset_count: 4,
      active_sessions: 3,
    },
    checked_at: isoMinutesAgo(2),
  };
}

export function buildSeed(): Db {
  const services = buildServices();
  const safetyReports: SafetyReport[] = services.map((s) =>
    buildSafetyReport(s.name, s.schema_manifest?.db_type ?? "postgres", s.safety_status === "passed"),
  );
  const serviceHealth: ServiceHealth[] = services.map((s) => ({
    id: uid("sh_"),
    service_name: s.name,
    connected: s.status !== "error",
    read_only: s.safety_status === "passed",
    latency_ms: s.status === "error" ? 0 : 42,
    checked_at: isoMinutesAgo(5),
    detail: (s.status === "error" ? { error: "Connection refused" } : { ok: true }) as Record<string, unknown>,
  }));
  const provisioningRuns: ProvisioningRun[] = [
    buildProvisioningRun("peoplesoft", "completed"),
    buildProvisioningRun("canvas", "completed"),
    buildProvisioningRun("slate", "failed", 3),
    buildProvisioningRun("snowflake", "running"),
  ];
  return {
    services,
    provisioning_runs: provisioningRuns,
    service_health: serviceHealth,
    safety_reports: safetyReports,
    sync_schedules: buildSyncSchedules(),
    sync_runs: buildSyncRuns(),
    mcp_sources: buildMcpSources(),
    mcp_tools: buildMcpTools(),
    mcp_toolsets: buildMcpToolsets(),
    roles: buildRoles(),
    health: buildHealth(),
  };
}