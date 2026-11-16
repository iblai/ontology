// NVIDIA/auto-ontology @ 22e22c89: request and response shapes of the engine's Next.js /api/*.
// Read from source (route.ts, auto_ontology/server/models.py, docs/openapi); never called.

// 401/403 from the Next auth wrapper, 400 from the configuration PUTs
export type AoNextError = { error: string };
// FastAPI errors relayed verbatim: an HTTPException string, or the 422 validation list
export type AoBackendError = { detail: string | AoValidationIssue[] };
export type AoValidationIssue = { loc: (string | number)[]; msg: string; type: string };

// Envelopes shared by the proxied routes
export type AoData<T> = { data: T };
export type AoList<T> = { data: T[]; count: number };
export type AoPage<T> = { data: T[]; count: number; total: number };

export type AoTagChip = { id: string; name: string };
export type AoZoneChip = {
  id: string;
  name: string | null;
  color: string | null;
  enabled: boolean | null;
};
// Added by the Next layer beside created_by / modified_by / tagged_by
export type AoAuthor = { id: string; name: string; email: string };

// --- Connections ---

// Secrets: required by test and ingest, blank keeps the stored value on PUT, never returned
type AoSecrets = {
  password?: string;
  password_env?: string;
  private_key?: string;
  private_key_passphrase?: string;
  truststore_password?: string;
};
type AoConnectionBase = AoSecrets & {
  database: string;
  schemas?: string[];
  // Single-schema shorthand: checked by test, dropped by create and update
  schema?: string;
  table_allow_regex?: string;
  table_deny_regex?: string;
  sso_federation?: boolean;
};
// POST /api/connections, POST /api/connections/test, PUT /api/connections/{database_name}
export type AoConnectionConfig = AoConnectionBase &
  (
    | { type: "postgresql" | "postgres" | "mysql"; host: string; user: string; port?: string }
    | { type: "heavydb"; host: string; user: string; port?: string; protocol?: string }
    | { type: "snowflake"; account: string; warehouse: string; user: string }
    | { type: "databricks"; host: string; http_path: string }
    | {
        type: "kyuubi";
        host: string;
        user: string;
        port?: string;
        ssa_url?: string;
        truststore_file?: string;
        truststore?: string;
      }
    | { type: "trino"; host: string; user: string; port?: string; http_scheme?: string }
    | { type: "clickhouse"; host: string; user?: string; port?: string; http_scheme?: string }
  );
// POST /api/connections, PUT /api/connections/{database_name}
export type AoConnectionBody = { connection: AoConnectionConfig };
// POST /api/connections/test
export type AoConnectionTestBody = AoConnectionBody & { replacing?: string | null };
// POST /api/connections/test
export type AoConnectionTestResponse = { success: boolean; schemas: string[] };
// GET /api/connections (AoList), POST / PUT / DELETE (AoData); connection is null on DELETE
export type AoPublicConnection = {
  database_name: string;
  connection: AoConnectionConfig | null;
};

// --- Catalog ---

// GET /api/datasources/dbs (AoList); schemas is always []
export type AoDatabaseSummary = {
  id: string;
  name: string | null;
  description: string | null;
  num_of_schemas: number | null;
  owner_id: string | null;
  schemas: AoSchemaSummary[];
};
export type AoSchemaSummary = {
  id: string;
  schema_name: string | null;
  description: string | null;
  tables_count: number | null;
  owner_id: string | null;
};
// GET /api/schemas/{db_id}; null when the database has no tables
export type AoSchemasPayload = { schemas: AoSchemaSummary[]; schemas_count: number } | null;
// GET /api/tables/{schema_id} (AoList)
export type AoTableSummary = {
  id: string;
  name: string | null;
  table_type: string | null;
  database_name: string | null;
  schema_name: string | null;
  description: string | null;
  description_certified: boolean | null;
  columns_count: number | null;
  sql_count: number | null;
  terms_count: number | null;
  owner_id: string | null;
  tags: AoTagChip[];
};
export type AoColumnSummary = {
  id: string;
  ordinal_position: number | null;
  column_name: string | null;
  data_type: string | null;
  description: string | null;
  description_certified: boolean | null;
  sample_values: string[] | null;
  tags: AoTagChip[];
};
// GET /api/columns/{table_id}; header fields are null for an unknown table
export type AoTableColumnsPage = {
  data: {
    table_name: string | null;
    table_type: string | null;
    schema_name: string | null;
    database_name: string | null;
    columns: AoColumnSummary[];
    columns_count: number | null;
  };
  count: number;
  total: number;
};

// --- Exploration ---

export type AoForeignKeyRef = {
  source_column: string | null;
  target_column: string | null;
  source_sample_values: string[] | null;
  target_sample_values: string[] | null;
};
// GET /api/exploration/graph (AoData)
export type AoDataGraph = {
  nodes: {
    id: string;
    name: string | null;
    table_type: string | null;
    database_id: string | null;
    database_name: string | null;
    schema_id: string | null;
    schema_name: string | null;
    description: string | null;
    columns_count: number | null;
    sql_count: number | null;
    terms_count: number | null;
    zones: AoZoneChip[];
    relationship_count: number | null;
  }[];
  links: {
    source: string;
    target: string;
    queries: string[];
    via_foreign_key: boolean;
    foreign_keys: AoForeignKeyRef[];
    relationship_types: string[];
  }[];
};
// GET /api/exploration/semantic-graph (AoData); a link is two terms sharing a table
export type AoSemanticGraph = {
  nodes: {
    id: string;
    name: string | null;
    description: string | null;
    synonyms: string[];
    zones: AoZoneChip[];
    relationship_count: number | null;
    column_attributes_count: number | null;
    sql_attributes_count: number | null;
  }[];
  links: { source: string; target: string; relationship_types: string[] }[];
};
export type AoTermSummary = { id: string; name: string | null; description: string | null };
// GET /api/exploration/tables/{table_id}/details (AoData)
export type AoTableExplorationDetails = {
  queries: { id: string; sql: string | null }[];
  terms: (AoTermSummary & { relationship_types: string[] })[];
  terms_total: number | null;
};
// GET /api/exploration/terms/{term_id}/details (AoData)
export type AoTermExplorationDetails = {
  tables: {
    id: string;
    name: string | null;
    table_type: string | null;
    database_id: string | null;
    database_name: string | null;
    schema_id: string | null;
    schema_name: string | null;
    relationship_types: string[];
  }[];
  tables_total: number | null;
};

// --- Terms and attributes ---

export type AoCertification = "certified" | "partial" | "pending";
// PATCH /api/terms/{term_id} (AoData)
export type AoTerm = AoTermSummary & {
  synonyms: string[] | null;
  name_certified: boolean | null;
  description_certified: boolean | null;
  certification: AoCertification | null;
  owner_id: string | null;
  zones: AoZoneChip[] | null;
};
type AoAudit = {
  created: string | null;
  modified: string | null;
  created_by: string | null;
  modified_by: string | null;
  created_by_user?: AoAuthor | null;
  modified_by_user?: AoAuthor | null;
};
export type AoTermCount = { term_id: string; count: number };
// GET /api/terms
export type AoTermsPage = {
  terms: (AoTerm & { schema_names: string[] | null; tags: AoTagChip[] })[];
  total: number;
  column_attribute_counts: AoTermCount[];
  sql_attribute_counts: AoTermCount[];
  related_counts: AoTermCount[];
};
// GET /api/terms/{term_id} (AoData); tables are the ones that REPRESENT the term
export type AoTermDetail = AoTerm &
  AoAudit & {
    table_count: number | null;
    tables: { id: string; name: string | null; schema_id: string | null; db_id: string | null }[];
    related_terms: AoTermSummary[];
    tags: AoTagChip[];
  };
// PATCH /api/terms/{term_id}
export type AoTermPatch = {
  name?: string;
  description?: string | null;
  name_certified?: boolean;
  description_certified?: boolean;
  owner_id?: string | null;
};
export type AoColumnRef = {
  id: string;
  column_name: string | null;
  table_id: string | null;
  table_name: string | null;
  schema_id: string | null;
  db_id: string | null;
};
// GET /api/terms/{term_id}/column-attributes (AoPage)
export type AoColumnAttribute = AoAudit & {
  id: string;
  name: string | null;
  description: string | null;
  term_name: string | null;
  source_column: string | null;
  datatype: string | null;
  table_id: string | null;
  sample_values: string[] | null;
  certified: boolean | null;
  zones: AoZoneChip[] | null;
  tags: AoTagChip[] | null;
  primary_column: AoColumnRef | null;
  referenced_columns: AoColumnRef[] | null;
};
// PATCH /api/terms/{term_id}/column-attributes/{attr_id}
export type AoColumnAttributePatch = {
  name?: string;
  description?: string | null;
  sample_values?: string[];
  certified?: boolean;
};
// GET /api/terms/{term_id}/sql-attributes (AoPage), GET /api/sql-attributes/{attr_id} (AoData)
export type AoSqlAttribute = AoAudit & {
  id: string;
  name: string | null;
  description: string | null;
  description_suggestion: string | null;
  expression: string | null;
  source: string | null;
  sql: string | null;
  sql_id: string | null;
  certified: boolean | null;
  term_id: string | null;
  term_name: string | null;
  database_name: string | null;
  owner_id: string | null;
  zones: AoZoneChip[] | null;
  tags: AoTagChip[] | null;
};
// PATCH /api/sql-attributes/{attr_id}
export type AoSqlAttributePatch = {
  name?: string;
  description?: string | null;
  certified?: boolean;
  owner_id?: string | null;
};
// PATCH /api/sql-attributes/{attr_id}, PATCH /api/terms/{term_id}/column-attributes/{attr_id}
export type AoAttributePatchResponse<T> = { data: T; term_certification: AoCertification | null };

// --- Tags ---

// GET /api/tags (AoPage); *_user only with ?authors=1 and an admin caller
export type AoTag = {
  id: string;
  name: string;
  created: string;
  modified: string;
  created_by: string | null;
  modified_by: string | null;
  created_by_user?: AoAuthor | null;
  modified_by_user?: AoAuthor | null;
};
export type AoTagTargetType = "term" | "table" | "column" | "column_attribute" | "sql_attribute";
// POST /api/tags/{tag_id}/targets; answers AoList<AoTagChip> of the object's tags
export type AoTagTarget = { type: AoTagTargetType; id: string };
// GET /api/tags/{tag_id}/targets (AoPage)
export type AoTagItem = {
  id: string;
  name: string;
  type: AoTagTargetType;
  path: string | null;
  tagged: string;
  tagged_by: string | null;
  tagged_by_user?: AoAuthor | null;
  rule: { id: string; name: string } | null;
  database_id: string | null;
  schema_id: string | null;
  table_id: string | null;
  term_id: string | null;
};

// --- Configuration and status ---

// GET / PUT /api/configurations/{semantic-compilation,pii-detection,distinct-value-probing}
export type AoToggle = { enabled: boolean };
// GET /api/semantic-compilation/status
export type AoSemanticStatus = {
  calculated: boolean;
  running: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
};

// POST /api/model/export; answers YAML, or a zip with include_ontology
export type AoExportRequest = {
  databases?: string[];
  format?: "auto_ontology" | "ossie";
  include_ontology?: boolean;
};

// --- Search ---

export type AoSearchObjectType =
  | "Database"
  | "Schema"
  | "Table"
  | "View"
  | "Column"
  | "CustomAnalysis"
  | "Term"
  | "ColumnAttribute"
  | "SqlAttribute"
  | "PqlAnalysis"
  | "Tag";
// POST /api/search/global-search, POST /api/search/global-search/count
export type AoSearchRequest = {
  search_term: string;
  text_match_option?: "contains";
  filters?: {
    description?: boolean;
    synonyms?: boolean;
    objects?: AoSearchObjectType[] | null;
    tags?: string[] | null;
    data?: string[] | null;
  };
};
// POST /api/search/global-search (AoList)
export type AoSearchItem = {
  id: string;
  name: string | null;
  type: string;
  table_type: string | null;
  description: string | null;
  certified: boolean | string | null;
  parent_id: string | null;
  breadcrumbs: { name: string; type: string; id: string | null }[];
  synonyms: string[];
};
// POST /api/search/global-search/count
export type AoSearchCount = { data: Record<string, number> };

// --- Chat ---

// POST /api/chat/completions
export type AoChatRequest = {
  question: string;
  evidence?: string | null;
  conversation_id?: string | null;
  target_db?: string | null;
  prediction?: boolean | null;
};
export type AoChatAnswer = {
  response: string;
  sql_code?: string;
  sql_columns?: unknown[];
  sql_response_from_db?: unknown;
  thoughts?: string;
};
// POST /api/chat/completions: each `data:` frame until `data: [DONE]`
export type AoChatEvent =
  | { type: "step"; phase: "start" | "end"; node: string; thought: string | null; label: string }
  | { type: "sql"; node: string; sql: string }
  | { type: "result"; answer: AoChatAnswer }
  | {
      type: "error";
      message: string;
      node?: string | null;
      error_type?: string;
      partial_answer?: { sql_code?: string; response?: string; thought?: string };
    }
  | { type: "charts"; content: string; sql_response: string | null };
