"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface PickerItem {
  value: string;
  label: string;
  /** Said quietly beside the label, and searched with it. */
  hint?: string;
  /** Items of one group are listed together under its name. */
  group?: string;
}

/** A searchable list to pick one thing from; once picked it folds to one line with "Change". */
export function Picker({
  items,
  value,
  onChange,
  label,
  placeholder,
  empty,
  change,
}: {
  items: PickerItem[];
  value: string;
  onChange: (value: string) => void;
  /** What is being picked, for a screen reader. */
  label: string;
  placeholder: string;
  empty: string;
  change: string;
}) {
  const picked = items.find((item) => item.value === value);
  if (picked) {
    return (
      <div
        data-slot="picker"
        className="border-input flex h-9 items-center justify-between gap-3 rounded-md border pr-1 pl-3"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-foreground truncate text-sm">{picked.label}</span>
          {picked.hint && (
            <span className="text-muted-foreground truncate text-xs">{picked.hint}</span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => onChange("")}
        >
          {change}
        </Button>
      </div>
    );
  }
  const groups = [...new Set(items.map((item) => item.group ?? ""))];
  return (
    <Command
      data-slot="picker"
      className="border-input h-auto border"
      label={label}
      // Every typed word is in the item as typed: "post" finds PostgreSQL, not PeopleSoft.
      filter={(item, typed) =>
        typed
          .toLowerCase()
          .split(/\s+/)
          .every((word) => item.toLowerCase().includes(word))
          ? 1
          : 0
      }
    >
      <CommandInput placeholder={placeholder} aria-label={label} />
      <CommandList className="max-h-72">
        <CommandEmpty>{empty}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group || undefined}>
            {items
              .filter((item) => (item.group ?? "") === group)
              .map((item) => (
                <CommandItem
                  key={item.value}
                  // With its own value: two items of one label are still two.
                  value={[item.label, item.hint, item.value].filter(Boolean).join(" ")}
                  onSelect={() => onChange(item.value)}
                >
                  <span>{item.label}</span>
                  {item.hint && <span className="text-muted-foreground text-xs">{item.hint}</span>}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
