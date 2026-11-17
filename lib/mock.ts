/**
 * Mock data for ibl.ai/ontology.
 *
 * Every export below is tagged with the system of record it will come from.
 * There is no fourth source: if a value is not available from one of these,
 * it is not in the UI. See docs/data-sources.md for the full audit.
 *
 *   IBL  — ibl.ai platform API, called from the browser with the SSO token
 *          (https://api.iblai.app/dm/api/…, exactly as the OS app does).
 *   AO   — NVIDIA auto-ontology REST API on the ontology host
 *          (/api/connections, /api/terms, /api/sql-attributes, /api/exploration/*,
 *          /api/semantic-compilation/status, ingestion :3002/ingest + /semantic/compile).
 *   TB   — Google MCP Toolbox: tools.yaml + launch flags on the host filesystem,
 *          the running process (/mcp, health) and its stdout log.
 *
 * AO and TB live on the server; the browser reaches them through this app's
 * route handlers, which verify the ibl.ai token and hold no data of their own.
 */

export { catalog, type CatalogKind } from "@/lib/view/catalog";

/** A system's key; any system name. */
export type SourceKey = string;

export const SOURCE_COLORS: Record<SourceKey, string> = {
  sis: "#336791",
  lms: "#E48E00",
  crm: "#7C3AED",
  fin: "#29B5E8",
};

/* ---------- tenant (IBL: /api/core/orgs/{org}/metadata/, user's tenants) ---------- */

export const tenant = {
  key: "university",
  name: "University",
  ontologyLabel: "Institution", // display name stored in org metadata.apps.ontology
};

/* ---------- systems (AO: GET /api/connections · TB: tools.yaml sources) ---------- */

export const systems = [
  {
    key: "sis" as SourceKey,
    name: "sis",
    engine: "PostgreSQL",
    abbr: "PG",
    url: "postgresql://sis_ro@banner-replica:5432/sis",
    detail: "42 tables · 2 PII columns",
    status: "ingested" as const,
    dissect: true,
  },
  {
    key: "lms" as SourceKey,
    name: "lms",
    engine: "MySQL",
    abbr: "My",
    url: "mysql://lms_ro@lms-replica:3306/edxapp",
    detail: "61 tables · scoped to 5",
    status: "ingested" as const,
    dissect: true,
  },
  {
    key: "crm" as SourceKey,
    name: "crm",
    engine: "PostgreSQL (Twenty CRM)",
    abbr: "PG",
    url: "postgresql://crm_ro@crm-db:5432/twenty",
    detail: "3 tables scoped",
    status: "ingested" as const,
    dissect: true,
  },
  {
    key: "fin" as SourceKey,
    name: "finance",
    engine: "Snowflake",
    abbr: "Sf",
    url: "snowflake://FIN_RO@acme.us-east-1/FIN",
    detail: "3 tables",
    status: "compiling" as const,
    dissect: true,
  },
];

/** HTTP APIs are served by Toolbox `http` sources only; they are not dissected. (TB) */
export const apiSystems = [
  {
    name: "slate",
    baseUrl: "https://slate.university.edu/manage/query/api",
    endpoints: 2,
    tools: 2,
  },
];

/* ---------- physical graph (AO: GET /api/exploration/data-graph, /api/tables, /api/columns) ---------- */

export type TableRow = { id: string; src: SourceKey; rows: number; cols: string[] };
export const tables: TableRow[] = [
  {
    id: "students",
    src: "sis",
    rows: 48211,
    cols: [
      "banner_id",
      "email",
      "first_name",
      "last_name",
      "program_code",
      "cum_gpa",
      "admit_term",
    ],
  },
  {
    id: "enrollments",
    src: "sis",
    rows: 612044,
    cols: ["id", "student_id", "section_id", "status", "grade"],
  },
  {
    id: "sections",
    src: "sis",
    rows: 9120,
    cols: ["id", "course_id", "instructor_id", "term_code", "credits"],
  },
  { id: "courses", src: "sis", rows: 2380, cols: ["id", "dept_id", "number", "title"] },
  { id: "instructors", src: "sis", rows: 1210, cols: ["id", "email", "dept_id"] },
  { id: "programs", src: "sis", rows: 96, cols: ["code", "dept_id", "name", "degree"] },
  { id: "departments", src: "sis", rows: 41, cols: ["id", "name"] },
  { id: "terms", src: "sis", rows: 60, cols: ["code", "start", "end"] },
  { id: "grades", src: "sis", rows: 598000, cols: ["enrollment_id", "letter", "points"] },
  { id: "auth_user", src: "lms", rows: 51900, cols: ["id", "username", "email", "last_login"] },
  {
    id: "student_courseenrollment",
    src: "lms",
    rows: 140300,
    cols: ["id", "user_id", "course_id", "mode", "is_active"],
  },
  { id: "course_overviews", src: "lms", rows: 640, cols: ["id", "display_name", "org"] },
  {
    id: "persistentcoursegrade",
    src: "lms",
    rows: 98700,
    cols: ["user_id", "course_id", "percent_grade"],
  },
  {
    id: "courseware_studentmodule",
    src: "lms",
    rows: 8900000,
    cols: ["id", "student_id", "module_id", "grade", "modified"],
  },
  { id: "person", src: "crm", rows: 121000, cols: ["id", "email", "company_id", "stage"] },
  {
    id: "opportunity",
    src: "crm",
    rows: 38400,
    cols: ["id", "person_id", "stage", "term", "amount"],
  },
  { id: "company", src: "crm", rows: 4100, cols: ["id", "name", "ceeb", "state"] },
  { id: "awards", src: "fin", rows: 77800, cols: ["id", "student_id", "type", "amount", "term"] },
  { id: "invoices", src: "fin", rows: 190000, cols: ["id", "student_id", "term", "balance"] },
  { id: "ledger", src: "fin", rows: 2100000, cols: ["id", "invoice_id", "amount", "posted"] },
];

/** AO: foreign keys confirmed or inferred (data-graph links). */
export const foreignKeys: [string, string][] = [
  ["enrollments", "students"],
  ["enrollments", "sections"],
  ["sections", "courses"],
  ["sections", "instructors"],
  ["sections", "terms"],
  ["courses", "departments"],
  ["students", "programs"],
  ["programs", "departments"],
  ["grades", "enrollments"],
  ["instructors", "departments"],
  ["student_courseenrollment", "auth_user"],
  ["student_courseenrollment", "course_overviews"],
  ["persistentcoursegrade", "auth_user"],
  ["courseware_studentmodule", "auth_user"],
  ["opportunity", "person"],
  ["person", "company"],
  ["awards", "students"],
  ["invoices", "students"],
  ["ledger", "invoices"],
];

/* ---------- semantic graph (AO: GET /api/terms, /api/exploration/semantic-graph, /api/term/{id}) ---------- */

export type Term = {
  id: string;
  maps: string[];
  desc: string;
  syn: string[];
  certified: boolean;
  tags: string[];
};
export const terms: Term[] = [
  {
    id: "Student",
    maps: ["students", "auth_user", "person"],
    desc: "A person admitted to and enrolled in at least one program.",
    syn: ["learner", "enrollee"],
    certified: true,
    tags: ["person"],
  },
  {
    id: "Course",
    maps: ["courses", "course_overviews"],
    desc: "A unit of instruction offered by a department.",
    syn: ["class"],
    certified: true,
    tags: [],
  },
  {
    id: "Section",
    maps: ["sections"],
    desc: "A scheduled instance of a course in a term.",
    syn: ["class section"],
    certified: true,
    tags: [],
  },
  {
    id: "Enrollment",
    maps: ["enrollments", "student_courseenrollment"],
    desc: "A student’s registration in a section.",
    syn: ["registration"],
    certified: true,
    tags: [],
  },
  {
    id: "Instructor",
    maps: ["instructors"],
    desc: "Faculty member assigned to sections.",
    syn: ["faculty", "teacher"],
    certified: true,
    tags: ["person"],
  },
  {
    id: "Program",
    maps: ["programs"],
    desc: "A degree or certificate pathway.",
    syn: ["major"],
    certified: true,
    tags: [],
  },
  {
    id: "Department",
    maps: ["departments"],
    desc: "Academic unit owning courses and programs.",
    syn: [],
    certified: true,
    tags: [],
  },
  {
    id: "Term",
    maps: ["terms"],
    desc: "Academic period.",
    syn: ["semester"],
    certified: true,
    tags: [],
  },
  {
    id: "Grade",
    maps: ["grades", "persistentcoursegrade"],
    desc: "Outcome of an enrollment.",
    syn: ["mark"],
    certified: true,
    tags: [],
  },
  {
    id: "Applicant",
    maps: ["opportunity"],
    desc: "A prospect with an application in the CRM pipeline.",
    syn: ["prospect", "lead"],
    certified: false,
    tags: ["person"],
  },
  {
    id: "HighSchool",
    maps: ["company"],
    desc: "Feeder secondary school.",
    syn: ["feeder"],
    certified: false,
    tags: [],
  },
  {
    id: "Award",
    maps: ["awards"],
    desc: "Financial aid disbursed to a student.",
    syn: ["aid", "scholarship"],
    certified: true,
    tags: ["billable"],
  },
  {
    id: "Invoice",
    maps: ["invoices", "ledger"],
    desc: "Tuition and fees billed to a student.",
    syn: ["bill"],
    certified: false,
    tags: ["billable"],
  },
  {
    id: "Engagement",
    maps: ["courseware_studentmodule"],
    desc: "LMS activity events per student.",
    syn: ["activity"],
    certified: true,
    tags: [],
  },
];

/** AO: semantic-graph links (related_terms). */
export const termLinks: [string, string][] = [
  ["Student", "Enrollment"],
  ["Enrollment", "Section"],
  ["Section", "Course"],
  ["Course", "Department"],
  ["Instructor", "Section"],
  ["Student", "Program"],
  ["Program", "Department"],
  ["Section", "Term"],
  ["Enrollment", "Grade"],
  ["Applicant", "Student"],
  ["Applicant", "HighSchool"],
  ["Student", "Award"],
  ["Student", "Invoice"],
  ["Student", "Engagement"],
];

/** AO: SQL attributes grouped by term (GET /api/sql-attributes). */
export const termMetrics: Record<string, string[]> = {
  Student: ["at_risk", "retention_rate", "credit_load"],
  Course: ["dfw_rate"],
  Applicant: ["yield_rate"],
  Invoice: ["outstanding_balance"],
};

/* ---------- ontology manager (AO) ---------- */

export const objectTypes = terms.map((t) => ({
  name: t.id,
  systems: new Set(t.maps.map((m) => tables.find((x) => x.id === m)?.src)).size,
  status: t.certified ? "certified" : "suggested",
}));

/** AO: term → columns (GET /api/exploration/term/{id}/details) with column PII flags from the catalog. */
export const studentProperties = [
  {
    name: "student_id",
    key: true,
    type: "string",
    column: "sis.students.banner_id",
    pii: false,
    status: "certified",
  },
  { name: "email", type: "string", column: "sis.students.email", pii: true, status: "certified" },
  {
    name: "full_name",
    type: "string",
    column: "concat(first_name,' ',last_name)",
    pii: true,
    status: "certified",
  },
  {
    name: "program",
    type: "→ Program",
    column: "sis.students.program_code",
    pii: false,
    status: "certified",
  },
  {
    name: "cumulative_gpa",
    type: "decimal",
    column: "sis.students.cum_gpa",
    pii: false,
    status: "certified",
  },
  {
    name: "lms_last_active",
    type: "timestamp",
    column: "lms.auth_user.last_login",
    pii: false,
    status: "suggested",
  },
  {
    name: "high_school",
    type: "→ HighSchool",
    column: "crm.person.company_id",
    pii: false,
    status: "suggested",
  },
  {
    name: "outstanding_balance",
    type: "money",
    column: "sum(finance.invoices.balance)",
    pii: false,
    status: "suggested",
  },
];

/** AO: relationships (GET /api/exploration/semantic-link-path, data-graph foreign keys). */
export const studentLinks = [
  {
    name: "enrolled_in",
    dir: "→",
    target: "Section",
    via: "sis.enrollments(student_id, section_id) · many",
  },
  { name: "studies", dir: "→", target: "Program", via: "sis.students.program_code · one" },
  { name: "received", dir: "→", target: "Award", via: "finance.awards.student_id · many" },
  { name: "billed", dir: "→", target: "Invoice", via: "finance.invoices.student_id · many" },
  {
    name: "was",
    dir: "←",
    target: "Applicant",
    via: "crm.opportunity.person_id via person.email · one",
  },
  {
    name: "engaged_with",
    dir: "→",
    target: "Engagement",
    via: "lms.courseware_studentmodule · many",
  },
];

/** AO: SQL attributes (expression, certified). */
export const studentMetrics = [
  {
    name: "retention_rate",
    expr: "count(distinct case when enrolled_next_term then student_id end) / count(distinct student_id)",
    grain: "Term · Program",
    status: "certified",
  },
  {
    name: "at_risk",
    expr: "cum_gpa < 2.0 or lms_last_active < now() - interval '14 days'",
    grain: "Student",
    status: "certified",
  },
  {
    name: "credit_load",
    expr: "sum(sections.credits)",
    grain: "Student · Term",
    status: "suggested",
  },
];

/** TB: write tools declared in tools.yaml (kind postgres-execute-sql / http POST), gated by toolset. */
export const studentActions = [
  {
    name: "flag_at_risk",
    sig: "(student_id, reason)",
    via: "http POST sis-api /advising/flags · toolset advising-actions",
  },
  {
    name: "create_advising_note",
    sig: "(student_id, note)",
    via: "postgres-sql INSERT sis.advising_notes · separate write login · toolset advising-actions",
  },
];

/* ---------- MCP gateway ---------- */

/** TB: toolsets and tools exactly as written in tools.yaml. */
export type Toolset = {
  name: string;
  summary: string;
  tools: { sig: string; note?: string }[];
  defaultOn: boolean;
  risk?: "writes" | "unrestricted";
};

export const toolsets: Toolset[] = [
  {
    name: "advising",
    summary: "Student · Enrollment · metrics",
    defaultOn: true,
    tools: [
      { sig: "get_student(student_id)", note: "→ Student" },
      { sig: "search_students(query, program?)", note: "→ Student[]" },
      { sig: "student_enrollments(student_id, term?)", note: "→ Enrollment[]" },
      { sig: "student_balance(student_id)", note: "→ money" },
      { sig: "at_risk_students(term, program?)", note: "metric · at_risk" },
      { sig: "retention_rate(term, program?)", note: "metric" },
      { sig: "ask_question(question)", note: "natural language → certified SQL" },
    ],
  },
  {
    name: "registrar",
    summary: "Course · Section · Instructor",
    defaultOn: true,
    tools: [
      { sig: "search_courses(query, department?)", note: "→ Course[]" },
      { sig: "get_section(section_id)", note: "→ Section" },
      { sig: "section_roster(section_id)", note: "→ Student[]" },
      { sig: "instructor_sections(instructor_id, term)", note: "→ Section[]" },
      { sig: "dfw_rate(course_id, term?)", note: "metric" },
      { sig: "describe_table(table)", note: "catalog" },
    ],
  },
  {
    name: "enrollment",
    summary: "Applicant · HighSchool · Slate API",
    defaultOn: true,
    tools: [
      { sig: "applicant_pipeline(term, stage?)", note: "→ Applicant[]" },
      { sig: "get_applicant(id)", note: "→ Applicant" },
      { sig: "slate_query(query_id)", note: "http · live API" },
      { sig: "yield_rate(term)", note: "metric" },
      { sig: "top_feeder_schools(term, n)", note: "→ HighSchool[]" },
      { sig: "search_terms(query)", note: "glossary" },
    ],
  },
  {
    name: "advising-actions",
    summary: "write tools",
    defaultOn: false,
    risk: "writes",
    tools: [
      { sig: "flag_at_risk(student_id, reason)" },
      { sig: "create_advising_note(student_id, note)" },
      { sig: "schedule_outreach(student_id, when)" },
      { sig: "close_flag(flag_id)" },
    ],
  },
  {
    name: "raw-sql",
    summary: "prebuilt · postgres · read-only login",
    defaultOn: false,
    risk: "unrestricted",
    tools: [{ sig: "execute_sql(sql)" }, { sig: "list_tables()" }],
  },
];

/** TB: --allowed-origins for this server's process (launch flags file). */
export const defaultOrigins = [
  "https://os.ibl.ai",
  "https://claude.ai",
  "https://advising.university.edu",
  "http://localhost:3000",
];

/**
 * Server registry. IBL: MCPServer (name, url, transport, auth_type, auth_scope, is_enabled).
 * TB: tools.yaml revision, toolsets, process health. Calls: IBL analytics tool_calls.
 */
export const servers = [
  {
    slug: "institution",
    revision: 8,
    enabled: true,
    toolsets: 3,
    tools: 19,
    calls24h: 2314,
    agents: 2,
    top: "at_risk_students",
    deployedAgo: "12m",
  },
  {
    slug: "advancement",
    revision: 3,
    enabled: true,
    toolsets: 1,
    tools: 9,
    calls24h: 410,
    agents: 1,
    top: "donor_lookup",
    deployedAgo: "6d",
  },
  {
    slug: "lms-analytics",
    revision: 0,
    enabled: false,
    toolsets: 0,
    tools: 0,
    calls24h: 0,
    agents: 0,
    top: "—",
    deployedAgo: "—",
  },
] as const;

/** IBL: analytics llm-usage observations with tool_calls [{name,input,output}] per agent session. */
export const agentToolCalls = [
  {
    t: "14:02:09",
    tool: "ask_question",
    agent: "agentAI",
    user: "advisor@university.edu",
    session: "s_8f21",
    status: "ok",
  },
  {
    t: "14:01:58",
    tool: "get_student",
    agent: "advising-bot",
    user: "—",
    session: "s_8f1c",
    status: "ok",
  },
  {
    t: "14:01:31",
    tool: "at_risk_students",
    agent: "agentAI",
    user: "advisor@university.edu",
    session: "s_8f21",
    status: "ok",
  },
  {
    t: "14:00:55",
    tool: "student_enrollments",
    agent: "agentAI",
    user: "student@university.edu",
    session: "s_8e90",
    status: "ok",
  },
  {
    t: "13:59:40",
    tool: "section_roster",
    agent: "advising-bot",
    user: "—",
    session: "s_8e71",
    status: "error",
  },
];

/** TB: tail of the Toolbox process stdout for this server (host filesystem / container log). */
export const gatewayLog = [
  "14:02:11 INFO  mcp tools/call at_risk_students origin=https://advising.university.edu 164ms 200",
  "14:01:40 WARN  rejected origin https://evil.example (not in --allowed-origins)",
  '14:01:12 INFO  mcp tools/call execute_sql → 404 tool not in toolset "advising"',
  "14:00:02 INFO  config reloaded tools.yaml (rev 8) · 19 tools · 3 toolsets",
];

/** IBL: GET /api/core/platform/api-tokens/?platform_key=… (name, created, expires, policies, groups). */
export const apiKeys = [
  {
    name: "ontology-institution-advising-bot",
    created: "2026-10-02",
    expires: "—",
    policies: ["ontology:advising"],
    groups: ["advisors"],
  },
  {
    name: "ontology-institution-dev",
    created: "2026-11-01",
    expires: "2026-12-31",
    policies: ["ontology:enrollment"],
    groups: [],
  },
];

/** IBL: agents whose settings include this MCP server (+ MCPServerConnection scope/auth_type). */
export const agents = [
  {
    name: "agentAI",
    kind: "ibl.ai agent",
    server: "institution",
    authScope: "user",
    authType: "oauth2",
    status: "enabled",
    calls: 1120,
  },
  {
    name: "advising-bot",
    kind: "ibl.ai agent",
    server: "institution",
    authScope: "mentor",
    authType: "token",
    status: "enabled",
    calls: 1902,
  },
  {
    name: "ir-analyst",
    kind: "ibl.ai agent",
    server: "institution",
    authScope: "platform",
    authType: "token",
    status: "enabled",
    calls: 412,
  },
];

/** Dashboard activity: AO term modified_by/modified · TB config revisions · IBL agent audit-logs. */
export const activity = [
  {
    tag: "deploy",
    tone: "green",
    text: "institution rev 8 · toolset advising added",
    when: "12m",
    source: "TB",
  },
  {
    tag: "certify",
    tone: "blue",
    text: "Student.retention_rate certified by M. Amigot",
    when: "1h",
    source: "AO",
  },
  {
    tag: "compile",
    tone: "gray",
    text: "finance · 3 tables profiled, 0 PII flags",
    when: "3h",
    source: "AO",
  },
  {
    tag: "agent",
    tone: "gray",
    text: "agentAI connected to institution (auth_scope user)",
    when: "1d",
    source: "IBL",
  },
];

export const sparklines = {
  calls: [3, 5, 4, 6, 8, 7, 9, 12, 10, 14, 11, 9, 13, 15, 12, 10],
  top: [2, 3, 2, 4, 5, 6, 5, 7, 9, 8, 10, 12, 11, 13, 14, 15],
};

/** TB: the generated file as written to the host. */
export const toolsYaml = `# generated · institution · rev 8 · do not edit by hand
sources:
  sis:
    kind: postgres
    host: banner-replica
    database: sis
    user: \${SIS_RO_USER}
    password: \${SIS_RO_PASSWORD}
  slate:
    kind: http
    baseUrl: https://slate.university.edu/manage/query/api
    headers:
      Authorization: Bearer \${SLATE_TOKEN}

authServices:
  entra:
    kind: oidc
    issuer: https://login.microsoftonline.com/\${TENANT}/v2.0
    audience: api://ontology

tools:
  get_student:
    kind: postgres-sql
    source: sis
    description: Fetch one Student by id. Student = a person
      admitted to and enrolled in ≥1 program.
    parameters:
      - { name: student_id, type: string }
    statement: |
      SELECT banner_id AS student_id, email, program_code,
             cum_gpa FROM students WHERE banner_id = $1
  my_enrollments:
    kind: postgres-sql
    source: sis
    authRequired: [entra]
    parameters:
      - name: email
        type: string
        authServices:            # bound from the ID token
          - { name: entra, field: email }
    statement: |
      SELECT … FROM enrollments e JOIN students s … WHERE s.email = $1
  slate_query:
    kind: http
    source: slate
    method: GET
    path: /{{.query_id}}
    pathParams:
      - { name: query_id, type: string }
  # … 16 more

toolsets:
  advising: [get_student, search_students, student_enrollments,
             student_balance, at_risk_students, retention_rate, ask_question]
  registrar: [search_courses, get_section, section_roster, …]
  enrollment: [applicant_pipeline, get_applicant, slate_query, yield_rate, …]`;
