import type {
  AgentConnection,
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
import { CUSTOM_API } from "../connectable";
import { isoHoursAgo, isoDaysAgo, isoMinutesAgo, uid } from "./store";

/**
 * The demo is one university: a student information system (PeopleSoft, a database), a
 * learning management system (Canvas) and two CRMs (Slate for admissions, Salesforce for
 * advising), the last three connected as web APIs. Each endpoint is one tool: its name, its
 * method, its path and what it does.
 */
const APIS: {
  name: string;
  display_name: string;
  host: string;
  endpoints: [string, string, string, string][];
}[] = [
  {
    name: "canvas",
    display_name: "Canvas LMS",
    host: "https://alasu.instructure.com/api/v1/",
    endpoints: [
      ["list-courses", "GET", "/users/{user_id}/courses", "List the courses a student is in"],
      [
        "get-grades",
        "GET",
        "/users/{user_id}/enrollments",
        "Get a student’s current grade in each course",
      ],
      [
        "missing-work",
        "GET",
        "/users/{user_id}/missing_submissions",
        "List the assignments a student has not handed in",
      ],
      ["send-message", "POST", "/conversations", "Send a student a message in the Canvas inbox"],
      [
        "grade-submission",
        "PUT",
        "/courses/{course_id}/assignments/{assignment_id}/submissions/{user_id}",
        "Grade or excuse a student’s submission",
      ],
    ],
  },
  {
    name: "slate",
    display_name: "Slate Admissions CRM",
    host: "https://apply.alasu.edu/manage/api/",
    endpoints: [
      ["get-prospect", "GET", "/prospects/{prospect_id}", "Get a prospective student’s record"],
      [
        "get-application",
        "GET",
        "/applications/{application_id}",
        "Get an application and its status",
      ],
      [
        "list-checklist",
        "GET",
        "/applications/{application_id}/checklist",
        "List what an application is still missing",
      ],
      [
        "log-interaction",
        "POST",
        "/prospects/{prospect_id}/interactions",
        "Log a call, an email or a visit with a prospect",
      ],
      [
        "update-application",
        "PATCH",
        "/applications/{application_id}",
        "Change an application’s status or its reader",
      ],
    ],
  },
  {
    name: "salesforce",
    display_name: "Salesforce Advising CRM",
    host: "https://alasu.my.salesforce.com/services/apexrest/advising/",
    endpoints: [
      ["list-cases", "GET", "/students/{student_id}/cases", "List a student’s open advising cases"],
      ["list-notes", "GET", "/students/{student_id}/notes", "List the advising notes on a student"],
      [
        "list-appointments",
        "GET",
        "/students/{student_id}/appointments",
        "List a student’s advising appointments",
      ],
      ["add-note", "POST", "/students/{student_id}/notes", "Add an advising note to a student"],
      ["book-appointment", "POST", "/appointments", "Book an advising appointment"],
      [
        "update-case",
        "PATCH",
        "/cases/{case_id}",
        "Change an advising case: its status, its owner or its next step",
      ],
      [
        "cancel-appointment",
        "DELETE",
        "/appointments/{appointment_id}",
        "Cancel an advising appointment",
      ],
    ],
  },
];
/** An API's tools that read (GET) or that change data (any other method), by name. */
const apiTools = (api: string, write: boolean) =>
  (APIS.find((a) => a.name === api)?.endpoints ?? [])
    .filter(([, method]) => (method !== "GET") === write)
    .map(([name]) => `${api}-${name}`);

function peopleSoftManifest() {
  const tables = [
    {
      schema_name: "SYSADM",
      table_name: "PS_STDNT_CAR_TERM",
      row_count: 2_345_678,
      column_count: 24,
      entity_group: "students",
      description: "Student career/term records: GPA, credits, status.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_STDNT_ENRL",
      row_count: 1_876_543,
      column_count: 31,
      entity_group: "enrollment",
      description: "Class enrollments per student and term.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_FIN_AID_AWD",
      row_count: 987_654,
      column_count: 18,
      entity_group: "financial_aid",
      description: "Financial aid awards by aid year.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_CLASS_TBL",
      row_count: 543_210,
      column_count: 42,
      entity_group: "courses",
      description: "Scheduled class sections per term.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_STDNT_BIO",
      row_count: 432_109,
      column_count: 27,
      entity_group: "students",
      description: "Student biographic and demographic data.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_SRVC_IND_DATA",
      row_count: 61_480,
      column_count: 19,
      entity_group: "students",
      description: "Service indicators: the holds on a student’s record.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_ASU_ADV_NOTE",
      row_count: 318_772,
      column_count: 9,
      entity_group: "advising",
      description: "Advising notes, one per meeting with a student.",
    },
    {
      schema_name: "SYSADM",
      table_name: "PS_INSTITUTION",
      row_count: 12,
      column_count: 15,
      entity_group: "other",
      description: "Institution reference table.",
    },
  ];
  return {
    db_type: "oracle",
    total_tables: 847,
    total_rows: 12_400_000,
    tables,
    database: "CSPRD",
  };
}

function buildSafetyReport(serviceName: string, dbType: string, passed: boolean): SafetyReport {
  const tests = (
    ["CREATE TABLE", "INSERT", "UPDATE", "DELETE", "DROP TABLE", "ALTER TABLE", "TRUNCATE"] as const
  ).map((name) => ({
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
      stepStatus =
        step_type === "docker_compose" && serviceName === "peoplesoft" ? "skipped" : "completed";
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
              ? ({ error: `Failed during ${step_type}: permission denied` } as Record<
                  string,
                  unknown
                >)
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
    error_message:
      status === "failed" ? `Pipeline failed at step ${stepTypes[failAtStep ?? 0]}.` : undefined,
    steps,
  };
}

function buildServices(): Service[] {
  return [
    {
      name: "peoplesoft",
      display_name: "PeopleSoft SIS",
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
    // A web API is called when an agent asks: nothing of it is synced.
    ...APIS.map((api): Service => ({
      name: api.name,
      display_name: api.display_name,
      service_type: "api",
      adapter: CUSTOM_API,
      status: "active",
      host: api.host,
      connection_config: { host: api.host, header: "Authorization", api_key: "********" },
      last_discovery_at: isoDaysAgo(6),
      safety_status: "pending",
      sync_status: "never_run",
      tables_synced: 0,
      rows_synced: 0,
      domain: "higher-ed",
    })),
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
      name: "peoplesoft-holds",
      cron: "*/15 * * * *",
      source: "peoplesoft",
      tool: "get-student-holds",
      mode: "delta",
      description: "Sync holds every 15 minutes",
      enabled: true,
    },
  ];
}

function buildSyncRuns(): SyncRun[] {
  const run = (
    schedule_name: string,
    minutesAgo: number,
    seconds: number,
    counts: [number, number, number],
    error_message?: string,
  ): SyncRun => ({
    id: uid("sr_"),
    schedule_name,
    source_system: "peoplesoft",
    started_at: isoMinutesAgo(minutesAgo),
    completed_at: isoMinutesAgo(minutesAgo - seconds / 60),
    status: error_message ? "failed" : "success",
    records_processed: counts[0],
    records_created: counts[1],
    records_updated: counts[2],
    error_message,
    duration_seconds: seconds,
  });
  return [
    run("peoplesoft-holds", 9, 11, [214, 6, 208]),
    run("peoplesoft-students", 45, 95, [1247, 12, 1235]),
    run("peoplesoft-financial-aid", 50, 42, [89, 3, 86]),
    run("peoplesoft-students", 105, 88, [1198, 8, 1190]),
    run("peoplesoft-financial-aid", 110, 30, [0, 0, 0], "ORA-12170: TNS:Connect timeout occurred"),
    run("peoplesoft-courses", 360, 28, [432, 0, 432]),
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
    // A login of its own for the few changes agents may make: reads never run on it.
    {
      kind: "source",
      name: "peoplesoft-rw",
      type: "oracle",
      host: "psft-db.internal.edu",
      port: 1521,
      database: "CSPRD",
      user: "iblai_advising_rw",
      password: "${PEOPLESOFT_RW_PASSWORD}",
    },
    // A web API has two: one its endpoints read through, one they change data through.
    ...APIS.flatMap((api): McpSource[] => [
      { kind: "source", name: `${api.name}-reads`, type: "http" },
      { kind: "source", name: `${api.name}-writes`, type: "http" },
    ]),
  ];
}

/** A PeopleSoft tool: one fixed statement on the read-only login, or on the one that may change data. */
function sisTool(
  name: string,
  description: string,
  statement: string,
  parameters: [string, string][],
): McpTool {
  return {
    kind: "tool",
    name,
    type: "oracle-sql",
    source: /^\s*select\b/i.test(statement) ? "peoplesoft-db" : "peoplesoft-rw",
    description,
    statement,
    parameters: parameters.map(([param, about]) => ({
      name: param,
      type: "string",
      description: about,
      required: true,
    })),
  };
}

const EMPLID: [string, string] = ["student_id", "The EMPLID of the student"];
const TERM: [string, string] = ["term", "The term code (e.g. 2268)"];
const CLASS: [string, string] = ["class_nbr", "The class number"];

function buildMcpTools(): McpTool[] {
  return [
    sisTool(
      "get-student-enrollment",
      "Get a student’s classes and grades by term",
      "SELECT * FROM SYSADM.PS_STDNT_ENRL WHERE EMPLID = :student_id AND STRM = :term",
      [EMPLID, TERM],
    ),
    sisTool(
      "get-degree-progress",
      "Get a student’s credits, GPA and standing by term",
      "SELECT * FROM SYSADM.PS_STDNT_CAR_TERM WHERE EMPLID = :student_id",
      [EMPLID],
    ),
    sisTool(
      "get-student-holds",
      "List the holds on a student’s record",
      "SELECT * FROM SYSADM.PS_SRVC_IND_DATA WHERE EMPLID = :student_id",
      [EMPLID],
    ),
    sisTool(
      "get-financial-aid",
      "Get a student’s financial aid awards by aid year",
      "SELECT * FROM SYSADM.PS_FIN_AID_AWD WHERE EMPLID = :student_id AND AID_YEAR = :aid_year",
      [EMPLID, ["aid_year", "The aid year (e.g. 2027)"]],
    ),
    sisTool(
      "get-course-catalog",
      "List the class sections offered in a term",
      "SELECT * FROM SYSADM.PS_CLASS_TBL WHERE STRM = :term",
      [TERM],
    ),
    sisTool(
      "add-advising-note",
      "Add an advising note to a student’s record",
      "INSERT INTO SYSADM.PS_ASU_ADV_NOTE (EMPLID, NOTE_DT, ADVISOR_ID, NOTE_TEXT) VALUES (:student_id, SYSDATE, :advisor_id, :note)",
      [EMPLID, ["advisor_id", "The advisor’s own id"], ["note", "The note’s text"]],
    ),
    sisTool(
      "release-advising-hold",
      "Release a student’s advising hold so they can enroll",
      "UPDATE SYSADM.PS_SRVC_IND_DATA SET SRVC_IND_ACTIVE = 'N' WHERE EMPLID = :student_id AND SRVC_IND_CD = 'ADV'",
      [EMPLID],
    ),
    sisTool(
      "post-final-grade",
      "Post a student’s final grade for a class",
      "UPDATE SYSADM.PS_STDNT_ENRL SET CRSE_GRADE_OFF = :grade WHERE EMPLID = :student_id AND STRM = :term AND CLASS_NBR = :class_nbr",
      [EMPLID, TERM, CLASS, ["grade", "The letter grade"]],
    ),
    sisTool(
      "drop-class",
      "Drop a student from a class",
      "UPDATE SYSADM.PS_STDNT_ENRL SET STDNT_ENRL_STATUS = 'D' WHERE EMPLID = :student_id AND STRM = :term AND CLASS_NBR = :class_nbr",
      [EMPLID, TERM, CLASS],
    ),
    ...APIS.flatMap((api) =>
      api.endpoints.map(([name, method, path, description]): McpTool => ({
        kind: "tool",
        name: `${api.name}-${name}`,
        type: "http",
        source: `${api.name}-${method === "GET" ? "reads" : "writes"}`,
        service: api.name,
        method,
        path,
        description,
        parameters: [
          ...[...path.matchAll(/\{([a-z_]+)\}/g)].map((m) => ({
            name: m[1],
            type: "string",
            description: m[1].replace(/_/g, " "),
          })),
          ...(["POST", "PUT", "PATCH"].includes(method)
            ? [{ name: "body", type: "map", description: "The JSON body to send, as one object." }]
            : []),
        ],
      })),
    ),
  ];
}

function buildMcpToolsets(): McpToolset[] {
  return [
    {
      kind: "toolset",
      name: "sis-enrollment",
      tools: ["get-student-enrollment", "get-degree-progress", "get-student-holds"],
    },
    { kind: "toolset", name: "sis-financial-aid", tools: ["get-financial-aid"] },
    { kind: "toolset", name: "sis-catalog", tools: ["get-course-catalog"] },
    // What advising may change in the SIS, apart from what only the registrar may.
    {
      kind: "toolset",
      name: "sis-advising-writes",
      tools: ["add-advising-note", "release-advising-hold"],
      write: true,
    },
    {
      kind: "toolset",
      name: "sis-registrar-writes",
      tools: ["post-final-grade", "drop-class"],
      write: true,
    },
    ...APIS.flatMap((api): McpToolset[] => [
      { kind: "toolset", name: `${api.name}-reads`, tools: apiTools(api.name, false) },
      { kind: "toolset", name: `${api.name}-writes`, tools: apiTools(api.name, true), write: true },
    ]),
  ];
}

function buildRoles(): Role[] {
  return [
    {
      name: "AcademicAdvisor",
      display_name: "Academic Advisor",
      // Reads all four systems. Changes the advising CRM, and in the SIS only what advising
      // may: a note and an advising hold, never a grade or an enrollment.
      mcp_toolsets: [
        "sis-enrollment",
        "sis-financial-aid",
        "sis-catalog",
        "sis-advising-writes",
        "canvas-reads",
        "slate-reads",
        "salesforce-reads",
        "salesforce-writes",
      ],
      mcp_tools: [],
      memory_paths: [
        "/ontology/students/**",
        "/ontology/enrollment/**",
        "/ontology/courses/**",
        "/ontology/advising/**",
      ],
      cache_tables: ["students", "enrollment", "courses", "advising"],
      admin_dashboard: false,
      agents: ["advising-agent"],
      concurrency_limits: { max_records_per_query: 1000 },
    },
    {
      name: "AdmissionsCounselor",
      display_name: "Admissions Counselor",
      // The admissions CRM is theirs; of the SIS they see the catalog alone.
      mcp_toolsets: ["slate-reads", "slate-writes", "sis-catalog"],
      mcp_tools: [],
      memory_paths: ["/ontology/courses/**"],
      cache_tables: ["courses"],
      admin_dashboard: false,
      agents: ["admissions-agent"],
      concurrency_limits: { max_records_per_query: 1000 },
    },
    {
      name: "FinancialAidCounselor",
      display_name: "Financial Aid Counselor",
      // Aid awards, and by name the two SIS reads an award depends on. Sees advising cases, changes nothing.
      mcp_toolsets: ["sis-financial-aid", "salesforce-reads"],
      mcp_tools: ["get-student-enrollment", "get-student-holds"],
      memory_paths: ["/ontology/financial_aid/**", "/ontology/students/**"],
      cache_tables: ["financial_aid", "students"],
      admin_dashboard: false,
      agents: ["financial-aid-agent"],
      concurrency_limits: { max_records_per_query: 1000 },
    },
    {
      name: "Registrar",
      display_name: "Registrar",
      // The SIS whole, grades and enrollment included; the other three to read.
      mcp_toolsets: [
        "sis-enrollment",
        "sis-financial-aid",
        "sis-catalog",
        "sis-advising-writes",
        "sis-registrar-writes",
        "canvas-reads",
        "slate-reads",
        "salesforce-reads",
      ],
      mcp_tools: [],
      memory_paths: ["/ontology/**"],
      cache_tables: ["*"],
      admin_dashboard: false,
      agents: ["registrar-agent"],
      concurrency_limits: { max_records_per_query: 10000 },
    },
    {
      name: "Faculty",
      display_name: "Faculty",
      // The LMS whole. Of the SIS: the catalog, a class’s enrollment, and posting a final grade.
      // Of the advising CRM: raising a note on a student, without reading the cases.
      mcp_toolsets: ["canvas-reads", "canvas-writes", "sis-catalog"],
      mcp_tools: ["get-student-enrollment", "post-final-grade", "salesforce-add-note"],
      memory_paths: ["/ontology/courses/**", "/ontology/enrollment/**"],
      cache_tables: ["courses", "enrollment"],
      admin_dashboard: false,
      agents: ["course-assistant"],
      concurrency_limits: { max_records_per_query: 1000 },
    },
    {
      name: "Student",
      display_name: "Student",
      // Their own record and courses, to read.
      mcp_toolsets: ["sis-catalog", "canvas-reads"],
      mcp_tools: ["get-student-enrollment", "get-degree-progress"],
      memory_paths: ["/ontology/students/by-id/${USER_EMPLID}.md", "/ontology/courses/**"],
      cache_tables: ["courses"],
      admin_dashboard: false,
      agents: ["student-help-agent"],
      concurrency_limits: { max_records_per_query: 100 },
    },
    {
      name: "IblaiOntologyAdmin",
      display_name: "Ontology Administrator",
      mcp_toolsets: ["*"],
      mcp_tools: [],
      memory_paths: ["/ontology/**"],
      cache_tables: ["*"],
      admin_dashboard: true,
      agents: [],
    },
  ];
}

/** Two of the platform’s agents already reach the gateway, each as one role. */
function buildAgentConnections(): AgentConnection[] {
  return [
    {
      name: "7b61e4d2-academicadvisor",
      agent: "7b61e4d2-0000-4000-8000-000000000002",
      agent_name: "Advising coach",
      role: "AcademicAdvisor",
      fingerprint: "4f9c21d07ab3",
      created_at: isoDaysAgo(9),
      created_by: "registrar@alasu.edu",
    },
    {
      name: "3f2a9c10-admissionscounselor",
      agent: "3f2a9c10-0000-4000-8000-000000000001",
      agent_name: "Admissions assistant",
      role: "AdmissionsCounselor",
      fingerprint: "b81e7c0452de",
      created_at: isoDaysAgo(4),
      created_by: "registrar@alasu.edu",
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
    // The one Toolbox runs the SIS’s statements and makes the calls to the three web APIs.
    mcp_servers: [{ name: "mcp-toolbox", reachable: true, latency_ms: 42, tool_count: 26 }],
    sync: {
      running: true,
      total_schedules: 4,
      failed_last_24h: 1,
      next_due_schedule: "peoplesoft-holds",
      next_due_at: isoMinutesAgo(-6),
    },
    storage: {
      total_files: 2_431,
      total_size_mb: 61.7,
      by_domain: [
        { domain: "students", files: 812, size_mb: 21.4 },
        { domain: "enrollment", files: 640, size_mb: 14.8 },
        { domain: "advising", files: 455, size_mb: 12.9 },
        { domain: "financial_aid", files: 301, size_mb: 7.6 },
        { domain: "courses", files: 215, size_mb: 2.9 },
        { domain: "_audit", files: 5, size_mb: 1.2 },
        { domain: "_schema", files: 3, size_mb: 0.9 },
      ],
    },
    gateway: {
      running: true,
      url: "https://ontology.alasu.edu/mcp",
      tool_count: 26,
      toolset_count: 11,
      active_sessions: 3,
    },
    checked_at: isoMinutesAgo(2),
  };
}

export function buildSeed(): Db {
  const services = buildServices();
  // A web API has no read-only suite to run: it gets no report.
  const safetyReports: SafetyReport[] = services
    .filter((s) => s.adapter !== CUSTOM_API)
    .map((s) =>
      buildSafetyReport(
        s.name,
        s.schema_manifest?.db_type ?? "postgres",
        s.safety_status === "passed",
      ),
    );
  const serviceHealth: ServiceHealth[] = services.map((s) => ({
    id: uid("sh_"),
    service_name: s.name,
    connected: s.status !== "error",
    read_only: s.safety_status === "passed",
    latency_ms: s.status === "error" ? 0 : 42,
    checked_at: isoMinutesAgo(5),
    detail: (s.status === "error" ? { error: "Connection refused" } : { ok: true }) as Record<
      string,
      unknown
    >,
  }));
  return {
    services,
    provisioning_runs: [buildProvisioningRun("peoplesoft", "completed")],
    service_health: serviceHealth,
    safety_reports: safetyReports,
    sync_schedules: buildSyncSchedules(),
    sync_runs: buildSyncRuns(),
    mcp_sources: buildMcpSources(),
    mcp_tools: buildMcpTools(),
    mcp_toolsets: buildMcpToolsets(),
    roles: buildRoles(),
    agent_connections: buildAgentConnections(),
    health: buildHealth(),
  };
}
