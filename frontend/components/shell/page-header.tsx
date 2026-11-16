import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="max-w-[64ch]">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = "gray" | "blue" | "green" | "amber" | "red";
const tones: Record<Tone, string> = {
  gray: "bg-[var(--hover-bg)] text-gray-600",
  blue: "bg-[#eef6fc] text-[#0058cc]",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
};

export function Pill({ tone = "gray", dot, pulse, className, children }: { tone?: Tone; dot?: boolean; pulse?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", tones[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full bg-current", pulse && "pulse")} />}
      {children}
    </span>
  );
}

export function Tag({ tone = "gray", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn("mono inline-flex h-5 items-center rounded px-1.5 text-[11px]", tones[tone], className)}>{children}</span>;
}

export function Stat({ value, label, spark, valueClass }: { value: ReactNode; label: string; spark?: number[]; valueClass?: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--border-color)] bg-white px-4 py-3.5">
      <b className={cn("block text-2xl font-semibold tracking-tight text-gray-900 tabular-nums", valueClass)}>{value}</b>
      <small className="text-[12.5px] text-gray-600">{label}</small>
      {spark && (
        <div className="mt-2 flex h-[26px] items-end gap-0.5">
          {spark.map((v, i) => (
            <i key={i} className="flex-1 rounded-t-sm bg-[#0058cc] opacity-55" style={{ height: `${(v / 15) * 100}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Card({ className, soft, children }: { className?: string; soft?: boolean; children: ReactNode }) {
  return <div className={cn("rounded-[10px] border border-[var(--border-color)] bg-white p-4", soft && "bg-[#fafbfc]", className)}>{children}</div>;
}
