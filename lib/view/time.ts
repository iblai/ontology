// Relative and clock times in the mock's short form.

const units: [string, number][] = [
  ["y", 365 * 86_400],
  ["mo", 30 * 86_400],
  ["w", 7 * 86_400],
  ["d", 86_400],
  ["h", 3_600],
  ["m", 60],
];

/** `<n><unit>` with unit s, m, h, d, w, mo or y ("12m", "6d"); "—" when there is no time. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  const [unit, size] = units.find(([, size]) => sec >= size) ?? ["s", 1];
  return `${Math.floor(sec / size)}${unit}`;
}

/** "14:02:09" in local time. */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
