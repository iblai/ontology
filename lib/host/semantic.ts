// The three tools the gateway serves itself, from the engine's REST API. The engine's own MCP
// server takes only OAuth tokens it issued, so it is not used.

import type {
  AoChatAnswer,
  AoChatEvent,
  AoData,
  AoList,
  AoSearchItem,
  AoSemanticStatus,
  AoTableColumnsPage,
  AoTableExplorationDetails,
} from "@/lib/ao-types";
import { aoFetch, aoJson } from "./ao";
import { currentPlatform } from "./platform";
import { readEngine } from "./reading";
import type { McpTool, McpToolResult } from "./types";

export const SEMANTIC_TOOLSET = "semantic";

const READY_MS = 30_000;
// ponytail: kept per process; several processes each ask the engine once in that time.
const ready = new Map<string, { until: number; value: Promise<boolean> }>();

/** Whether the platform's engine holds a semantic layer, which the three tools answer from. */
export function semanticReady(): Promise<boolean> {
  const platform = currentPlatform();
  const kept = ready.get(platform);
  if (kept && Date.now() < kept.until) return kept.value;
  // An engine that does not answer has no layer to offer either.
  const value = aoJson<AoSemanticStatus>("/semantic-compilation/status", {
    signal: AbortSignal.timeout(5_000),
  }).then(
    (status) => status.calculated === true,
    () => false,
  );
  ready.set(platform, { until: Date.now() + READY_MS, value });
  return value;
}

export const SEMANTIC_TOOLS: McpTool[] = [
  {
    name: "ask_question",
    description:
      "Answer a question in plain language from the certified semantic layer. Returns the answer and the SQL that ran.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The question to answer." } },
      required: ["question"],
    },
  },
  {
    name: "search_terms",
    description: "Search the glossary of business terms by name, description or synonym.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "At least two characters." } },
      required: ["query"],
    },
  },
  {
    name: "describe_table",
    description: "List a table's columns, types, tags and the terms mapped to it.",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string", description: "A table name, or schema.table." } },
      required: ["table"],
    },
  },
];

/** How the builder lists them, in the mock's words. */
export const SEMANTIC_NOTES: Record<string, { sig: string; note: string }> = {
  ask_question: { sig: "ask_question(question)", note: "natural language → certified SQL" },
  search_terms: { sig: "search_terms(query)", note: "glossary" },
  describe_table: { sig: "describe_table(table)", note: "catalog" },
};

/** Runs one of the three. A failure is a result with isError, in the engine's words. */
export async function callSemantic(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    if (name === "search_terms") return await searchTerms(stringArg(args, "query"));
    if (name === "describe_table") return await describeTable(stringArg(args, "table"));
    if (name === "ask_question") return await askQuestion(stringArg(args, "question"));
    return failed(`unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return failed(`the engine did not answer within ${ASK_MS / 1000} s`);
    }
    return failed(error instanceof Error ? error.message : String(error));
  }
}

const ASK_MS = 120_000;
// The engine's words for a run its model did not answer (auto_ontology's chat agent).
const NO_ANSWER = /^LLM failed to produce a response\.?$/i;
const JSON_HEADERS = { "content-type": "application/json" };

const text = (value: unknown) => ({ type: "text" as const, text: JSON.stringify(value) });
const failed = (message: string): McpToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

// One content per term, as the runtime answers one content per row.
async function searchTerms(query: string): Promise<McpToolResult> {
  if (query.length < 2) return failed("query must be at least two characters");
  const found = await aoJson<AoList<AoSearchItem>>("/search/global-search", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      search_term: query,
      filters: { objects: ["Term"], description: true, synonyms: true },
    }),
  });
  return {
    content: found.data.map((t) =>
      text({
        name: t.name,
        description: t.description,
        synonyms: t.synonyms,
        certified: t.certified === true || t.certified === "certified",
      }),
    ),
  };
}

async function describeTable(table: string): Promise<McpToolResult> {
  const dot = table.lastIndexOf(".");
  const schema = dot > 0 ? table.slice(0, dot).toLowerCase() : null;
  const name = table.slice(dot + 1).toLowerCase();
  const { graph } = await readEngine();
  const matches = graph.nodes.filter(
    (n) =>
      n.name?.toLowerCase() === name &&
      (schema === null || n.schema_name?.toLowerCase() === schema),
  );
  if (matches.length === 0) return failed(`no table named ${table}`);
  if (matches.length > 1) {
    const names = matches.map((n) => `${n.schema_name}.${n.name} (${n.database_name})`);
    return failed(`${table} names ${matches.length} tables: ${names.join(", ")}`);
  }
  const node = matches[0];
  const id = encodeURIComponent(node.id);
  const [columns, details] = await Promise.all([
    aoJson<AoTableColumnsPage>(`/columns/${id}`),
    aoJson<AoData<AoTableExplorationDetails>>(`/exploration/tables/${id}/details`),
  ]);
  return {
    content: [
      text({
        table: node.name,
        schema: node.schema_name,
        database: node.database_name,
        columns: columns.data.columns.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          tags: c.tags.map((t) => t.name),
        })),
        terms: details.data.terms.map((t) => ({ name: t.name, description: t.description })),
      }),
    ],
  };
}

// The engine's words for a refused question: a JSON { detail } or { error }, else its text.
async function refusal(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    const words = parsed.detail ?? parsed.error;
    if (typeof words === "string") return words;
    if (words !== undefined) return JSON.stringify(words);
  } catch {
    // plain text, as the engine's Next layer answers 403 and 502
  }
  return body || `the engine answered ${response.status}`;
}

// The answer arrives as server-sent events: `data: <json>` frames, `: ping`, then `data: [DONE]`.
async function askQuestion(question: string): Promise<McpToolResult> {
  const response = await aoFetch("/chat/completions", {
    method: "POST",
    headers: { ...JSON_HEADERS, accept: "text/event-stream" },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(ASK_MS),
  });
  if (!response.ok || !response.body) return failed(await refusal(response));

  // Read to [DONE], so an error after the result is not missed.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let answer: AoChatAnswer | null = null;
  let provenance: unknown = null;
  let buffered = "";
  for (let done = false; !done;) {
    const chunk = await reader.read();
    done = chunk.done;
    buffered += chunk.value ?? "";
    const lines = buffered.split("\n");
    buffered = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        done = true;
        break;
      }
      let event: AoChatEvent;
      try {
        event = JSON.parse(payload) as AoChatEvent;
      } catch {
        continue; // a frame that is not JSON carries no answer
      }
      if (event.type === "error") {
        await reader.cancel();
        return failed(event.message || "the engine’s agent failed");
      }
      if (event.type === "result") {
        answer = event.answer;
        provenance = (event.answer as { provenance?: unknown }).provenance ?? null;
      }
    }
  }
  await reader.cancel();
  if (!answer) return failed("the engine ended the run without an answer");
  // With no model to call, the engine ends its run in a result that only says so.
  if (!answer.sql_code && NO_ANSWER.test(answer.response ?? "")) {
    return failed(
      `${answer.response} The server needs a model to answer questions: its operator sets OPENAI_API_KEY.`,
    );
  }
  return {
    content: [text({ answer: answer.response, sql: answer.sql_code ?? null, provenance })],
  };
}
