// A small reading written by hand, shared by the reading and toolsets tests.

import type { AoColumnAttribute, AoDataGraph, AoSqlAttribute, AoTermDetail } from "@/lib/ao-types";
import type { Reading, ReadTerm } from "./reading";

const audit = { created: null, modified: null, created_by: null, modified_by: null };

type Place = { id: string; name: string; schema: string; db: string; dbName: string };

const PLACES: Place[] = [
  { id: "t-students", name: "students", schema: "public", db: "db1", dbName: "sis" },
  { id: "t-enrol", name: "enrollments", schema: "public", db: "db1", dbName: "sis" },
  { id: "t-sections", name: "sections", schema: "public", db: "db1", dbName: "sis" },
  { id: "t-course", name: "courses", schema: "public", db: "db1", dbName: "sis" },
  { id: "t-cust", name: "customers", schema: "sales", db: "db2", dbName: "crm" },
];
const at = (id: string) => PLACES.find((p) => p.id === id)!;
const schemaId = (p: Place) => (p.db === "db1" ? "s1" : "s2");

function term(
  id: string,
  name: string,
  certified: [boolean, boolean],
  table: string,
  tags: string[],
): AoTermDetail {
  const p = at(table);
  return {
    ...audit,
    id,
    name,
    description: `What a ${name} is.`,
    synonyms: [],
    name_certified: certified[0],
    description_certified: certified[1],
    certification: null,
    owner_id: null,
    zones: [],
    table_count: 1,
    tables: [{ id: p.id, name: p.name, schema_id: schemaId(p), db_id: p.db }],
    related_terms: [],
    tags: tags.map((t) => ({ id: `tag-${t}`, name: t })),
  };
}

function column(
  name: string,
  table: string,
  columnName: string,
  datatype: string,
  certified: boolean,
  pointedFrom: string[] = [],
): AoColumnAttribute {
  const ref = (id: string, col: string) => {
    const p = at(id);
    return {
      id: `${id}.${col}`,
      column_name: col,
      table_id: p.id,
      table_name: p.name,
      schema_id: schemaId(p),
      db_id: p.db,
    };
  };
  return {
    ...audit,
    id: `${table}.${columnName}`,
    name,
    description: null,
    term_name: null,
    source_column: columnName,
    datatype,
    table_id: table,
    sample_values: null,
    certified,
    zones: null,
    tags: null,
    primary_column: ref(table, columnName),
    referenced_columns: pointedFrom.map((from) => ref(from, `${columnName}_ref`)),
  };
}

function metric(name: string, sql: string, certified: boolean): AoSqlAttribute {
  return {
    ...audit,
    id: `m-${name}`,
    name,
    description: null,
    description_suggestion: null,
    expression: sql,
    source: null,
    sql,
    sql_id: null,
    certified,
    term_id: null,
    term_name: null,
    database_name: null,
    owner_id: null,
    zones: null,
    tags: null,
  };
}

const terms: ReadTerm[] = [
  {
    term: term("term-student", "Student", [true, true], "t-students", ["Advising", "SIS"]),
    columns: [
      column("Student ID", "t-students", "banner_id", "character varying", true, ["t-enrol"]),
      column("Email", "t-students", "email", "text", true),
      column("GPA", "t-students", "gpa", "numeric", true),
      column("Notes", "t-students", "notes", "text", false),
    ],
    sql: [
      metric("Retention Rate", "SELECT count(*) FROM students WHERE retained", true),
      metric("Purge Inactive", "DELETE FROM students WHERE active = false", true),
      metric("Draft", "SELECT 1", false),
    ],
  },
  {
    term: term("term-enrol", "Enrollment", [true, true], "t-enrol", ["Advising"]),
    columns: [column("Status", "t-enrol", "status", "varchar(20)", true)],
    sql: [],
  },
  { term: term("term-section", "Section", [true, true], "t-sections", []), columns: [], sql: [] },
  {
    term: term("term-course", "Course", [true, false], "t-course", ["Advising"]),
    columns: [column("Title", "t-course", "title", "text", true)],
    sql: [metric("Fill Rate", "SELECT 0.5", true)],
  },
  { term: term("term-cust", "Customer", [true, true], "t-cust", []), columns: [], sql: [] },
];

const graph: AoDataGraph = {
  nodes: PLACES.map((p) => ({
    id: p.id,
    name: p.name,
    table_type: "TABLE",
    database_id: p.db,
    database_name: p.dbName,
    schema_id: schemaId(p),
    schema_name: p.schema,
    description: null,
    columns_count: 5,
    sql_count: 0,
    terms_count: 1,
    zones: [],
    relationship_count: 1,
  })),
  // Stored lowest id first, as the engine does: the direction is not in the link.
  links: [
    {
      source: "t-enrol",
      target: "t-students",
      queries: [],
      via_foreign_key: true,
      foreign_keys: [
        {
          source_column: "student_ref",
          target_column: "banner_id",
          source_sample_values: null,
          target_sample_values: null,
        },
      ],
      relationship_types: ["FOREIGN_KEY"],
    },
    {
      source: "t-enrol",
      target: "t-sections",
      queries: [],
      via_foreign_key: true,
      foreign_keys: [
        {
          source_column: "section_ref",
          target_column: "id",
          source_sample_values: null,
          target_sample_values: null,
        },
      ],
      relationship_types: ["FOREIGN_KEY"],
    },
    {
      source: "t-course",
      target: "t-enrol",
      queries: ["SELECT 1"],
      via_foreign_key: false,
      foreign_keys: [],
      relationship_types: ["SQL"],
    },
  ],
};

export function fixtureReading(): Reading {
  return {
    connections: [
      {
        database_name: "sis",
        connection: {
          type: "postgresql",
          host: "db.example",
          user: "ro",
          port: "5432",
          database: "sis",
          schemas: ["public"],
        },
      },
      {
        database_name: "crm",
        connection: { type: "databricks", host: "dbx.example", http_path: "/sql", database: "crm" },
      },
      {
        database_name: "lms",
        connection: { type: "postgresql", host: "lms.example", user: "u", database: "lms" },
      },
    ],
    databases: [
      {
        id: "db1",
        name: "sis",
        description: null,
        num_of_schemas: 1,
        owner_id: null,
        schemas: [
          { id: "s1", schema_name: "public", description: null, tables_count: 4, owner_id: null },
        ],
      },
      {
        id: "db2",
        name: "crm",
        description: null,
        num_of_schemas: 1,
        owner_id: null,
        schemas: [
          { id: "s2", schema_name: "sales", description: null, tables_count: 1, owner_id: null },
        ],
      },
    ],
    graph,
    semantic: {
      nodes: [],
      links: [{ source: "term-student", target: "term-enrol", relationship_types: ["SHARES"] }],
    },
    terms,
    pii: { sis: 2, crm: 0 },
    status: { calculated: true, running: false, last_success_at: null, last_failure_at: null },
  };
}
