"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Blocks, Database } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { apiClient } from "@/lib/ontology/api-client";
import { CATALOG } from "@/lib/ontology/catalog";
import type { Service } from "@/lib/ontology/types";
import { CREATE_ACTIONS, PLATFORM_SIDEBAR_SECTIONS } from "./nav-config";

const PaletteContext = createContext({ open: () => {} });

/** Opens the ⌘K palette. */
export function useCommandPalette() {
  return useContext(PaletteContext);
}

/** ⌘K / Ctrl+K anywhere: jump to a page, a service or a connector, or create something. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PaletteContext.Provider value={{ open }}>
      {children}
      <CommandPalette open={isOpen} onOpenChange={setIsOpen} />
    </PaletteContext.Provider>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-white px-1 font-sans">{children}</kbd>;
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("palette");
  const tn = useTranslations("nav");
  const ts = useTranslations("shell");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    apiClient.services.list().then(setServices, () => setServices([]));
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  // Records only once something is typed; the empty palette is pages and actions.
  const searching = search.trim() !== "";

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      className="top-[15%] translate-y-0 sm:max-w-xl"
    >
      <CommandInput placeholder={t("placeholder")} value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        <CommandGroup heading={t("goTo")}>
          {PLATFORM_SIDEBAR_SECTIONS.flatMap((g) => g.items).map((item) => (
            <CommandItem
              key={item.href}
              value={`go ${tn(item.labelKey)}`}
              onSelect={() => go(item.href)}
            >
              <item.icon />
              {tn(item.labelKey)}
            </CommandItem>
          ))}
        </CommandGroup>
        {searching && services.length > 0 && (
          <CommandGroup heading={t("services")}>
            {services.map((s) => (
              <CommandItem
                key={s.name}
                value={`service ${s.name} ${s.display_name}`}
                onSelect={() => go(`/services/${encodeURIComponent(s.name)}`)}
              >
                <Database />
                <span className="truncate">{s.display_name}</span>
                <span className="text-muted-foreground ml-auto text-xs">{s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {searching && (
          <CommandGroup heading={t("connectors")}>
            {CATALOG.map((c) => (
              <CommandItem
                key={c.key}
                value={`connector ${c.key} ${c.display_name}`}
                onSelect={() => go(`/catalog/${encodeURIComponent(c.key)}`)}
              >
                <Blocks />
                <span className="truncate">{c.display_name}</span>
                <span className="text-muted-foreground ml-auto text-xs">{c.domain}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading={t("create")}>
          {CREATE_ACTIONS.map((a) => (
            <CommandItem key={a.id} value={`new ${ts(a.labelKey)}`} onSelect={() => go(a.href)}>
              <a.icon />
              {ts(a.labelKey)}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-[11px]">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> {t("toNavigate")}
        </span>
        <span>
          <Kbd>↵</Kbd> {t("toOpen")}
        </span>
        <span>
          <Kbd>esc</Kbd> {t("toClose")}
        </span>
      </div>
    </CommandDialog>
  );
}
