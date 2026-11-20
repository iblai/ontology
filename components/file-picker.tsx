"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, CornerLeftUp, FileText, Folder, House, Search } from "lucide-react";
import { useLocalFolder } from "@/lib/data";
import type { HostFolder } from "@/lib/host/types";
import { cn } from "@/lib/utils";

/** Bytes as B, KB, MB or GB. */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The folders from the root down to `folder`, each with its full path. */
function crumbsOf({ root, path }: HostFolder): { name: string; path: string }[] {
  const below = path.slice(root.length).split("/").filter(Boolean);
  const home = { name: root.split("/").filter(Boolean).pop() ?? "/", path: root };
  return [
    home,
    ...below.map((name, i) => ({ name, path: [root, ...below.slice(0, i + 1)].join("/") })),
  ];
}

/**
 * Walks the folders under the server's root. A click on a folder opens it, and a click on a
 * folder or a file hands its full path to `onPick`; `picked` is the path the form now holds.
 */
export function FilePicker({ picked, onPick }: { picked: string; onPick: (path: string) => void }) {
  const [folder, setFolder] = useState(""); // "" asks for the root
  const [find, setFind] = useState("");
  const query = useLocalFolder(folder);
  // The folder that loaded last stays on screen while the next one is asked for.
  const [shown, setShown] = useState<HostFolder | null>(null);
  if (query.data && query.data !== shown) setShown(query.data);

  // The folder being browsed is the last crumb: keep it in view when the path is long.
  const trail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (trail.current) trail.current.scrollLeft = trail.current.scrollWidth;
  }, [shown?.path]);

  const open = (path: string) => {
    setFolder(path);
    setFind("");
    onPick(path);
  };

  const entries = shown?.entries ?? [];
  const needle = find.trim().toLowerCase();
  const listed = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries;
  const folders = entries.filter((e) => e.dir).length;

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border-color)] bg-white text-[13px]">
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] bg-[#fafbfc] py-1 pr-1 pl-2">
        <div
          ref={trail}
          className="flex min-w-0 flex-1 [scrollbar-width:none] items-center overflow-x-auto"
        >
          {shown ? (
            crumbsOf(shown).map((crumb, i, all) => (
              <span key={crumb.path} className="flex flex-none items-center">
                {i > 0 && <ChevronRight className="mx-0.5 size-3 text-gray-400" aria-hidden />}
                <button
                  type="button"
                  onClick={() => open(crumb.path)}
                  className={cn(
                    "mono flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--hover-bg)]",
                    i === all.length - 1 ? "font-medium text-gray-900" : "text-gray-600",
                  )}
                >
                  {i === 0 && <House className="size-3.5 text-gray-500" aria-hidden />}
                  {crumb.name}
                </button>
              </span>
            ))
          ) : (
            <span className="px-1 py-0.5 text-gray-500">{query.error ? "—" : "Loading…"}</span>
          )}
        </div>
        <button
          type="button"
          aria-label="Up one folder"
          title="Up one folder"
          disabled={!shown || shown.parent === null}
          onClick={() => shown?.parent && open(shown.parent)}
          className="grid size-7 flex-none place-items-center rounded text-gray-600 hover:bg-[var(--hover-bg)] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <CornerLeftUp className="size-3.5" aria-hidden />
        </button>
      </div>

      {entries.length > 8 && (
        <label className="flex items-center gap-2 border-b border-[var(--border-color)] px-2.5 py-1.5 text-gray-500">
          <Search className="size-3.5 flex-none" aria-hidden />
          <input
            aria-label="Filter this folder"
            className="w-full bg-transparent text-gray-900 outline-none placeholder:text-gray-400"
            placeholder="Filter this folder"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
        </label>
      )}

      <div
        className={cn(
          "h-[264px] overflow-y-auto py-1 transition-opacity",
          query.isLoading && "opacity-60",
        )}
      >
        {query.error && <p className="px-3 py-2 text-xs text-red-600">{query.error}</p>}
        {listed.map((e) => {
          const at = `${shown?.path.replace(/\/+$/, "")}/${e.name}`;
          const on = picked === at;
          const Icon = e.dir ? Folder : FileText;
          return (
            <button
              key={e.name}
              type="button"
              aria-current={on || undefined}
              onClick={() => (e.dir ? open(at) : onPick(at))}
              className={cn(
                "group grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 border-l-2 border-transparent py-1.5 pr-2.5 pl-2 text-left hover:bg-[var(--hover-bg)]",
                on && "border-[#0058cc] bg-[#eef6fc] text-[#0058cc] hover:bg-[#eef6fc]",
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  e.dir ? "text-[#0058cc]" : "text-gray-400",
                  on && "text-[#0058cc]",
                )}
                aria-hidden
              />
              <span className="mono truncate">{e.name}</span>
              {e.dir ? (
                <ChevronRight
                  className="size-3.5 text-gray-300 group-hover:text-gray-500"
                  aria-hidden
                />
              ) : (
                <span
                  className={cn(
                    "text-[11.5px] tabular-nums",
                    on ? "text-[#0058cc]" : "text-gray-500",
                  )}
                >
                  {sizeOf(e.size)} · {dayOf(e.modified)}
                </span>
              )}
            </button>
          );
        })}
        {shown && !query.error && listed.length === 0 && (
          <p className="grid h-full place-items-center px-3 text-center text-xs text-gray-500">
            {needle ? "Nothing here matches the filter." : "Nothing to pick in this folder."}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--border-color)] bg-[#fafbfc] px-2.5 py-1.5 text-[11.5px] text-gray-500">
        {shown ? `${plural(folders, "folder")} · ${plural(entries.length - folders, "file")}` : " "}
        {shown?.truncated && " · more than are shown"}
      </div>
    </div>
  );
}
