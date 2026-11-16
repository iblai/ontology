import type { AoTableColumnsPage } from "@/lib/ao-types";
import type { ColumnRow } from "@/lib/view/types";

type Kind = ColumnRow["kind"];

const NUMERIC =
  /(^|\W)u?(big|small|tiny|medium)?int|serial|numeric|decimal|float|double|real|money|number/;

/** numeric, temporal or text from the engine's data_type. */
export function kindOfType(dataType: string | null): Exclude<Kind, "key"> {
  const t = (dataType ?? "").toLowerCase();
  if (/date|time|interval/.test(t)) return "temporal";
  return NUMERIC.test(t) ? "numeric" : "text";
}

// The engine gives no keys: "key" is an `id` / `…_id` column of a table at a foreign key's end.
export function columnRows(
  page: AoTableColumnsPage,
  tableId: string,
  foreignKeys: [string, string][],
): ColumnRow[] {
  const joined = foreignKeys.some(([a, b]) => a === tableId || b === tableId);
  return page.data.columns.map((c) => {
    const name = c.column_name ?? "—";
    return {
      name,
      kind: joined && /^id$|_id$/i.test(name) ? "key" : kindOfType(c.data_type),
      pii: c.tags.some((t) => t.name.toUpperCase() === "PII"),
    };
  });
}

/** Demo mode: kind and PII from a mocked column's name, with the mocked Map page's rules. */
export function demoColumn(name: string): ColumnRow {
  const kind: Kind = /id$|_id|code/.test(name)
    ? "key"
    : /gpa|amount|balance|credits|percent|points/.test(name)
      ? "numeric"
      : /term|login|modified|posted|start|end/.test(name)
        ? "temporal"
        : "text";
  return { name, kind, pii: /email|name/.test(name) };
}
