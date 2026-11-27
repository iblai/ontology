// Demo mode (NEXT_PUBLIC_DEMO=1): what the mocked build rendered, in the view shapes. The mock
// gives the data; the literals the mocked pages held are here.

import type { HostApiEndpoint, HostFolder, HostSystemTest } from "@/lib/host/types";
import * as mock from "@/lib/mock";
import { mcpPath } from "@/lib/platform";
import type {
  ActivityRow,
  AgentOption,
  AgentRow,
  ColumnRow,
  CountsView,
  EngineView,
  GraphView,
  KeyRow,
  ObjectTypeView,
  OntologyTree,
  PipelineView,
  LinkRow,
  PlayTool,
  RoleRow,
  ServerActivityView,
  ServerRow,
  ServerView,
  Status,
  SystemsView,
  ToolRun,
  ToolsetView,
} from "@/lib/view/types";
import { demoColumn } from "./columns";
import { linkName } from "./ontology";

const st = (certified: boolean): Status => (certified ? "certified" : "suggested");

export const demoEndpoint = (slug: string) =>
  `https://ontology.university.edu${mcpPath("university", slug)}`;
export const demoOrigins = mock.defaultOrigins;
export const demoYaml = mock.toolsYaml;

/* ---------- systems ---------- */

// The Systems page painted its own badge colours, not the Map's palette.
const systemColors: Record<string, string> = {
  sis: "#336791",
  lms: "#E48E00",
  crm: "#FF7A59",
  fin: "#29B5E8",
};
const systemNumbers: Record<string, [number, boolean, number, number | null]> = {
  sis: [42, false, 2, 9],
  lms: [5, true, 1, 4],
  crm: [3, true, 1, 3],
  fin: [3, false, 0, null],
};

export const demoSystems: SystemsView = {
  systems: mock.systems.map((s) => {
    const [tables, scoped, pii, terms] = systemNumbers[s.key];
    return {
      ...s,
      color: systemColors[s.key],
      serve: true,
      tables,
      scoped,
      pii,
      terms,
    };
  }),
  apis: mock.apiSystems,
  prebuilt: [
    { toolset: "postgres-raw", label: "postgres · execute_sql, list_tables" },
    { toolset: "bigquery-raw", label: "bigquery · execute_sql, get_table_info" },
    { toolset: "mysql-raw", label: "mysql · execute_sql, list_tables" },
  ],
  files: [],
};

/** The folder the Filesystem picker shows. */
export const demoFolder: HostFolder = {
  root: "/srv/data",
  path: "/srv/data",
  parent: null,
  entries: [
    { name: "handbook", dir: true, size: 0, modified: "2026-01-01T00:00:00Z" },
    { name: "catalog.csv", dir: false, size: 48213, modified: "2026-01-01T00:00:00Z" },
  ],
  truncated: false,
};

export const demoTest: HostSystemTest = {
  ok: true,
  message: "3 tables visible",
  ms: 210,
  tables: 3,
};

export const demoSpec: HostApiEndpoint[] = ["contacts", "deals", "companies"].map((o) => ({
  name: `get_v3_objects_${o}`,
  method: "GET" as const,
  path: `/v3/objects/${o}`,
  description: "",
  query: [],
}));

/* ---------- map ---------- */

export const demoGraph: GraphView = {
  sources: Object.entries(mock.SOURCE_COLORS).map(([key, color]) => ({ key, name: key, color })),
  tables: mock.tables.map((t) => ({
    id: t.id,
    name: t.id,
    src: t.src,
    rows: t.rows,
    cols: t.cols.map(demoColumn),
  })),
  foreignKeys: mock.foreignKeys,
  terms: mock.terms.map((t) => ({ ...t, name: t.id })),
  termLinks: mock.termLinks,
  // The mocked Map marked every metric suggested.
  termMetrics: Object.fromEntries(
    Object.entries(mock.termMetrics).map(([term, names]) => [
      term,
      names.map((name) => ({ id: name, name, certified: false })),
    ]),
  ),
};

export const demoColumns = (tableId: string): ColumnRow[] =>
  demoGraph.tables.find((t) => t.id === tableId)?.cols ?? [];

const b = (text: string) => ({ b: text });

export const demoPipeline: PipelineView = {
  current: 6,
  busy: false,
  lines: [
    [
      { parts: [b("ingest"), " sis, lms, crm, finance → 202 accepted"] },
      { parts: ["sis: 42 tables · lms: 61 tables (scoped 5) · crm: 3 · finance: 3"] },
    ],
    [
      { parts: ["profiling 109 tables · sampling 500 rows each"] },
      {
        parts: [
          "PII tags: ",
          b("students.email"),
          ", ",
          b("students.first_name"),
          ", ",
          b("auth_user.email"),
          ", ",
          b("person.email"),
          " · samples masked",
        ],
        ok: true,
      },
      {
        parts: ["distinct probing: enrollments.status {REGISTERED, DROPPED, WAITLIST, WITHDRAWN}"],
      },
    ],
    [
      { parts: ["naming business terms per table…"] },
      { parts: ['Student ← students (0.96) · "learner, enrollee"'] },
      { parts: ["14 terms · 41 column mappings · vector index written"], ok: true },
    ],
    [
      { parts: ["resolving joins: 19 FKs confirmed, 3 inferred (no constraint)"] },
      {
        parts: ["Student mapped to 3 tables in 3 databases: students, auth_user, person"],
        ok: true,
      },
      {
        parts: [
          "metrics: at_risk, retention_rate, dfw_rate, yield_rate, outstanding_balance, credit_load",
        ],
      },
    ],
    [
      { parts: [b("POST /semantic/compile"), " → 202 · polling /semantic/status"] },
      { parts: ["compiled · 14 terms · 11 relationships · 6 SQL attributes"], ok: true },
    ],
    [
      { parts: ["14 object types → 22 tools · 3 toolsets · tools.yaml 9.8 KB"], ok: true },
      { parts: [b("ready"), " → review the ontology, then expose"], ok: true },
    ],
  ],
  // The mocked banner offered "Certify Student".
  banner: {
    termId: "Student",
    term: "Student",
    tables: ["sis.students", "lms.auth_user", "crm.person"],
    certified: false,
  },
};

/* ---------- ontology ---------- */

export const demoOntology: OntologyTree = {
  objectTypes: mock.objectTypes.map((o) => ({
    id: o.name,
    name: o.name,
    systems: o.systems,
    status: st(o.status === "certified"),
  })),
  linkTypes: [
    "enrolled_in",
    "teaches",
    "became",
    "studies",
    "received",
    "billed",
    "engaged_with",
    "offered_by",
    "scheduled_in",
    "graded_as",
    "part_of",
  ],
  metrics: [
    "retention_rate",
    "dfw_rate",
    "yield_rate",
    "at_risk",
    "credit_load",
    "outstanding_balance",
  ],
  actions: ["flag_at_risk", "create_advising_note", "schedule_outreach"],
  tags: ["person", "billable"],
  certified: 14,
  suggested: 9,
};

const student: ObjectTypeView = {
  id: "Student",
  name: "Student",
  description: "A person admitted to and enrolled in at least one program.",
  tags: ["person"],
  systems: 3,
  status: "certified",
  synonyms: ["learner", "enrollee", "pupil"],
  backing: [
    { color: "#336791", name: "sis.students", note: "primary · 48,211 rows" },
    { color: "#E48E00", name: "lms.auth_user", note: "join on lower(email)" },
    { color: "#7C3AED", name: "crm.person", note: "join on lower(email)" },
  ],
  properties: mock.studentProperties.map((p) => ({
    ...p,
    id: p.name,
    status: st(p.status === "certified"),
  })),
  links: mock.studentLinks.map((l) => ({ ...l, dir: l.dir as LinkRow["dir"] })),
  metrics: mock.studentMetrics.map((m) => ({
    ...m,
    id: m.name,
    status: st(m.status === "certified"),
  })),
  actions: mock.studentActions,
};

/** Student as the mocked page showed it; any other term from the mock's own fields. */
export function demoObjectType(id: string): ObjectTypeView | undefined {
  if (id === "Student") return student;
  const t = mock.terms.find((x) => x.id === id);
  if (!t) return undefined;
  const tables = t.maps.flatMap((m) => mock.tables.filter((x) => x.id === m));
  return {
    id: t.id,
    name: t.id,
    description: t.desc,
    tags: t.tags,
    systems: new Set(tables.map((x) => x.src)).size,
    status: st(t.certified),
    synonyms: t.syn,
    backing: tables.map((x, i) => ({
      color: mock.SOURCE_COLORS[x.src],
      name: `${x.src}.${x.id}`,
      note: i === 0 ? `primary · ${x.rows.toLocaleString("en-US")} rows` : "shared key",
    })),
    properties: tables.flatMap((x, i) =>
      x.cols.map((c) => {
        const col = demoColumn(c);
        return {
          id: `${x.id}.${c}`,
          name: c,
          key: (i === 0 && col.kind === "key") || undefined,
          type: col.kind === "key" ? "string" : col.kind,
          column: `${x.src}.${x.id}.${c}`,
          pii: col.pii,
          status: st(t.certified),
        };
      }),
    ),
    links: mock.termLinks
      .filter((l) => l.includes(t.id))
      .map(([a, z]) => {
        const target = a === t.id ? z : a;
        const via = mock.terms.find((x) => x.id === target)?.maps[0];
        const src = mock.tables.find((x) => x.id === via)?.src;
        return {
          name: linkName(t.id, target),
          dir: (a === t.id ? "→" : "←") as LinkRow["dir"],
          target,
          via: via && src ? `${src}.${via}` : "—",
        };
      }),
    metrics: (mock.termMetrics[t.id] ?? []).map((name) => ({
      id: name,
      name,
      expr: "—",
      grain: t.id,
      status: st(false),
    })),
    actions: [],
  };
}

/* ---------- gateway ---------- */

export const demoToolsets: ToolsetView[] = mock.toolsets;

const hosts = ["ontology.university.edu"];
const serverExtras: Record<string, Omit<ServerRow, keyof (typeof mock.servers)[number] | "url">> = {
  institution: {
    toolsetNames: ["advising", "registrar", "enrollment"],
    origins: mock.defaultOrigins,
    hosts,
    auth: { platform: true, entra: { tenant: "8123…", audience: "api://ontology" } },
    bytes: 10035,
    port: 5001,
  },
  advancement: {
    toolsetNames: ["advancement"],
    origins: mock.defaultOrigins,
    hosts,
    auth: { platform: true },
    bytes: 4710,
    port: 5002,
  },
  "lms-analytics": {
    toolsetNames: [],
    origins: mock.defaultOrigins,
    hosts,
    auth: { platform: true },
    bytes: 0,
    port: null,
  },
};

export const demoServers: ServerRow[] = mock.servers.map((s) => ({
  ...s,
  url: demoEndpoint(s.slug),
  ...serverExtras[s.slug],
}));

export function demoServer(slug: string): ServerView | null {
  const s = demoServers.find((x) => x.slug === slug);
  return s ? { ...s, yaml: mock.toolsYaml } : null;
}

/** Why the demo, which creates no server, refuses to deploy one; null for one of its samples. */
export function demoDeployRefusal(slug: string): string | null {
  if (demoServer(slug)) return null;
  const samples = demoServers.map((s) => s.slug).join(", ");
  return `The demo creates no servers. Deploy one of its samples: ${samples}.`;
}

export const demoServerActivity: ServerActivityView = {
  calls: mock.agentToolCalls.map((c) => ({
    ...c,
    status: (c.status === "ok" ? "ok" : "error") as "ok" | "error",
  })),
  log: mock.gatewayLog,
  spark: mock.sparklines,
};

export const demoKeys: KeyRow[] = mock.apiKeys.map((k) => ({ ...k, id: k.name }));

export const demoAgents: AgentRow[] = mock.agents.map((a) => ({ ...a, id: a.name }));

export const demoAgentOptions: AgentOption[] = mock.agents.map((a) => ({
  id: a.name,
  name: a.name,
}));

export const demoFeed: ActivityRow[] = mock.activity.map(({ tag, tone, text, when }) => ({
  tag,
  tone: tone as ActivityRow["tone"],
  text,
  when,
}));

export const demoRoles: RoleRow[] = [
  { name: "ontology:admin", toolsets: [], all: true, holders: [] },
  {
    name: "ontology:advising",
    toolsets: ["advising", "registrar", "advising-actions"],
    all: false,
    holders: [{ label: "advisors", kind: "group", users: 412 }],
  },
  {
    name: "ontology:enrollment",
    toolsets: ["enrollment", "registrar"],
    all: false,
    holders: [{ label: "ir-analysts", kind: "group", users: 9 }],
  },
  {
    name: "ontology:self-service",
    toolsets: ["my_* tools · rows bound to the signed-in email"],
    all: false,
    holders: [],
  },
  { name: "ontology:raw", toolsets: ["raw-sql"], all: false, holders: [] },
];

export const demoEngine: EngineView = {
  running: false,
  lastSuccess: "3h ago",
  lastFailure: null,
  switches: { compilation: true, pii: true, probing: true },
  timeout: "60 s",
  terms: 14,
  relationships: 11,
};

// The sidebar's literals: 31 is not derivable from the mock.
export const demoCounts: CountsView = {
  systems: 4,
  catalog: 109,
  ontology: 14,
  gateway: 31,
  roles: 5,
  agents: 3,
};

/* ---------- playground ---------- */

const termArgs = '{"term": "2026-FA", "program": "CS-BS"}';

export const demoPlayTools: PlayTool[] = [
  { name: "at_risk_students", args: termArgs },
  { name: "get_student", args: '{"student_id": "A00412"}' },
  { name: "retention_rate", args: termArgs },
  {
    name: "ask_question",
    args: '{"question": "How many CS-BS students are at risk for 2026-FA?"}',
  },
];

const rowKeys = ["student_id", "email", "program", "cum_gpa", "lms_last_active", "reason"];
const rows = [
  ["A00412…", "j.okafor@university.edu", "CS-BS", "1.84", "2026-10-29", "gpa"],
  ["A00398…", "m.lindqvist@university.edu", "CS-BS", "2.71", "2026-10-12", "inactive 33d"],
  ["A00377…", "r.alvarez@university.edu", "CS-BS", "1.92", "2026-10-20", "gpa · inactive"],
  ["A00351…", "s.nair@university.edu", "CS-BS", "1.67", "2026-11-10", "gpa"],
].map((r) => Object.fromEntries(rowKeys.map((k, i) => [k, r[i]])));

export function demoRun(tool: string): ToolRun {
  if (tool !== "ask_question") return { ok: true, status: 200, ms: 164, rows, total: 312 };
  return {
    ok: true,
    status: 200,
    ms: 2700,
    answer: {
      text: "312 students in CS-BS are at risk for 2026-FA: 201 by GPA, 143 by LMS inactivity, 32 by both.",
      sql: `SELECT count(*) FROM students s LEFT JOIN lms.auth_user u ON lower(u.email)=lower(s.email)
WHERE s.program_code='CS-BS' AND (s.cum_gpa < 2.0 OR u.last_login < now() - interval '14 days')`,
      provenance: "term Student (certified) · metric at_risk (certified)",
    },
  };
}
