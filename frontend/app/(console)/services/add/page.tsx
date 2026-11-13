"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import { CATALOG } from "@/lib/ontology/catalog";
import type { Service } from "@/lib/ontology/types";
import {
  CONNECTABLE,
  TWENTY_CLOUD,
  apiAddress,
  connectable,
  freeName,
  headerName,
  portDigits,
  systemName,
  twentyAddress,
  validPort,
} from "@/lib/ontology/connectable";
import { Field, PLAIN } from "@/components/console/form-dialog";
import { Picker } from "@/components/console/picker";
import { SectionHeader } from "@/components/console/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AddSystemPage() {
  const t = useTranslations("addService");
  const router = useRouter();
  const from = connectable(useSearchParams().get("from"));

  const [system, setSystem] = useState(from?.key ?? "");
  const [hosting, setHosting] = useState<"cloud" | "self">("cloud");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  // How a custom API is signed in to: a bearer token, a key in a header of its own, or nothing.
  const [auth, setAuth] = useState<"bearer" | "header" | "none">("bearer");
  const [header, setHeader] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(from?.port ? String(from.port) : "");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  // The name people read, once one is typed; until then the system's or the database's own.
  const [label, setLabel] = useState("");
  const [named, setNamed] = useState(false);
  // The systems connected already: a name is never one of theirs.
  const [others, setOthers] = useState<Service[]>([]);
  useEffect(() => {
    apiClient.services.list().then(setOthers, (e) => console.error("systems load failed", e));
  }, []);
  // What the backend said about one login's databases; another login's answer is not this one's.
  const [found, setFound] = useState<{ login: string; databases: string[]; refused: string }>();
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);

  const picked = connectable(system);
  const login = [picked?.adapter, host.trim(), port, user, password].join("\n");
  const listed = found?.login === login ? found : undefined;

  function pick(key: string) {
    const next = connectable(key);
    setSystem(key);
    // One system's address and key are not another's.
    setAddress("");
    setApiKey("");
    setPort(next?.port ? String(next.port) : "");
    setDatabase("");
    setFound(undefined);
  }

  /** On leaving a field, not as it is typed: half a password is a failed sign-in on their server. */
  async function lookUp() {
    if (!picked?.lookup || looking || found?.login === login) return;
    if (!host.trim() || !validPort(port) || !user || !password) return;
    setLooking(true);
    try {
      const res = await apiClient.services.databases({
        adapter: picked.adapter,
        host: host.trim(),
        port: Number(port),
        user,
        password,
      });
      setFound({ login, databases: res.databases ?? [], refused: res.ok ? "" : res.message });
      if (res.ok && res.databases.length === 1) setDatabase(res.databases[0]);
    } catch (err) {
      setFound({ login, databases: [], refused: err instanceof Error ? err.message : String(err) });
    } finally {
      setLooking(false);
    }
  }

  // The technical name is worked out: from what was typed, else Twenty's own or the database's.
  const untyped = picked?.kind === "twenty" ? picked.key : systemName(database.trim());
  const name = freeName(
    systemName(named ? label.trim() : untyped).replace(/-+$/, ""),
    others.map((s) => s.name),
  );
  const display_name = named && label.trim() ? label.trim() : undefined;
  // A second Twenty is kept apart from the first: said before it is connected.
  const sibling = picked?.kind === "twenty" && others.some((s) => s.adapter === picked.adapter);
  const nameOk = /^[a-z0-9][a-z0-9-]*$/.test(name);
  const ready =
    nameOk &&
    (picked?.kind === "twenty"
      ? apiKey.trim() !== "" && (hosting === "cloud" || twentyAddress(address))
      : picked?.kind === "api"
        ? apiAddress(address) &&
          (auth === "none" || apiKey.trim() !== "") &&
          (auth !== "header" || headerName(header))
        : picked?.kind === "terms"
          ? apiAddress(address)
          : picked?.kind === "database" &&
            host.trim() !== "" &&
            (!picked.port || validPort(port)) &&
            database.trim() !== "" &&
            user.trim() !== "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || !ready || busy) return;
    const domain = CATALOG.find((c) => c.adapter === picked.adapter)?.domain ?? "higher-ed";
    setBusy(true);
    try {
      const res = await apiClient.services.add(
        picked.kind === "twenty"
          ? {
              name,
              display_name,
              service_type: "api",
              adapter: picked.adapter,
              host: hosting === "cloud" ? TWENTY_CLOUD : address.trim(),
              api_key: apiKey.trim(),
              domain,
            }
          : picked.kind === "api"
            ? {
                name,
                display_name,
                service_type: "api",
                adapter: picked.adapter,
                host: address.trim(),
                // The header's whole value: a bearer token goes after its scheme word.
                api_key:
                  auth === "none"
                    ? ""
                    : auth === "bearer"
                      ? `Bearer ${apiKey.trim()}`
                      : apiKey.trim(),
                options:
                  auth === "none"
                    ? undefined
                    : { header: auth === "bearer" ? "Authorization" : header.trim() },
                domain,
              }
            : picked.kind === "terms"
              ? {
                  name,
                  display_name,
                  service_type: "api",
                  adapter: picked.adapter,
                  host: address.trim(),
                  // Empty for a server reached directly, which asks for none.
                  api_key: apiKey.trim(),
                  domain,
                }
              : {
                  name,
                  display_name,
                  service_type: "database",
                  adapter: picked.adapter,
                  host: host.trim(),
                  port: port ? Number(port) : undefined,
                  database: database.trim(),
                  user: user.trim(),
                  password: password || undefined,
                  domain,
                },
      );
      if (res.ok) {
        toast.success(res.message);
        router.push(`/services/${name}`);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const items = CONNECTABLE.map((c) => ({
    value: c.key,
    label: c.label,
    group: c.kind === "database" ? t("groupDatabases") : t("groupApplications"),
  }));
  // A list to pick from once the backend answered with one; a name to type when it could not.
  const pickDatabase =
    Boolean(picked?.lookup) && !listed?.refused && listed?.databases.length !== 0;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      <Card className="max-w-xl">
        <CardContent className="py-4">
          <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
            <Field label={t("system")}>
              <Picker
                items={items}
                value={system}
                onChange={pick}
                label={t("system")}
                placeholder={t("systemSearch")}
                empty={t("systemNone")}
                change={t("systemChange")}
              />
            </Field>

            {picked?.kind === "twenty" && (
              <>
                <Field label={t("hosting")} htmlFor="hosting">
                  <Select value={hosting} onValueChange={(v) => setHosting(v as "cloud" | "self")}>
                    <SelectTrigger id="hosting">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cloud">{t("hostingCloud")}</SelectItem>
                      <SelectItem value="self">{t("hostingSelf")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {hosting === "self" && (
                  <Field
                    label={t("address")}
                    htmlFor="address"
                    error={address && !twentyAddress(address) ? t("addressInvalid") : undefined}
                  >
                    <Input
                      id="address"
                      type="url"
                      inputMode="url"
                      placeholder="https://crm.example.com"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      {...PLAIN}
                    />
                  </Field>
                )}
                <Field label={t("apiKey")} htmlFor="api-key" hint={t("apiKeyHint")}>
                  <Input
                    id="api-key"
                    type="password"
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </Field>
              </>
            )}

            {picked?.kind === "api" && (
              <>
                <Field
                  label={t("address")}
                  htmlFor="api-address"
                  hint={t("apiAddressHint")}
                  error={address && !apiAddress(address) ? t("apiAddressInvalid") : undefined}
                >
                  <Input
                    id="api-address"
                    type="url"
                    inputMode="url"
                    placeholder="https://api.example.com/v1"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    {...PLAIN}
                  />
                </Field>
                <Field label={t("signIn")} htmlFor="sign-in">
                  <Select value={auth} onValueChange={(v) => setAuth(v as typeof auth)}>
                    <SelectTrigger id="sign-in">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bearer">{t("signInBearer")}</SelectItem>
                      <SelectItem value="header">{t("signInHeader")}</SelectItem>
                      <SelectItem value="none">{t("signInNone")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {auth === "header" && (
                  <Field
                    label={t("headerName")}
                    htmlFor="header-name"
                    error={header && !headerName(header) ? t("headerNameInvalid") : undefined}
                  >
                    <Input
                      id="header-name"
                      placeholder="X-API-Key"
                      value={header}
                      onChange={(e) => setHeader(e.target.value)}
                      {...PLAIN}
                    />
                  </Field>
                )}
                {auth !== "none" && (
                  <Field
                    label={t(auth === "bearer" ? "token" : "key")}
                    htmlFor="api-secret"
                    hint={t("passwordHint")}
                  >
                    <Input
                      id="api-secret"
                      type="password"
                      autoComplete="new-password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </Field>
                )}
              </>
            )}

            {picked?.kind === "terms" && (
              <>
                <Field
                  label={t("address")}
                  htmlFor="terms-address"
                  hint={t("termsAddressHint")}
                  error={address && !apiAddress(address) ? t("apiAddressInvalid") : undefined}
                >
                  <Input
                    id="terms-address"
                    type="url"
                    inputMode="url"
                    placeholder="https://auto-ontology.example.com"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    {...PLAIN}
                  />
                </Field>
                <Field label={t("token")} htmlFor="terms-token" hint={t("termsTokenHint")}>
                  <Input
                    id="terms-token"
                    type="password"
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </Field>
              </>
            )}

            {picked?.kind === "database" && (
              <>
                <div className={picked.port ? "grid grid-cols-[1fr_7rem] gap-4" : undefined}>
                  <Field
                    label={t("host")}
                    htmlFor="host"
                    hint={picked.key === "snowflake" ? t("hostHintSnowflake") : undefined}
                  >
                    <Input
                      id="host"
                      inputMode="url"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      onBlur={lookUp}
                      {...PLAIN}
                    />
                  </Field>
                  {picked.port && (
                    <Field
                      label={t("port")}
                      htmlFor="port"
                      error={port && !validPort(port) ? t("portInvalid") : undefined}
                    >
                      <Input
                        id="port"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={5}
                        value={port}
                        onChange={(e) => setPort(portDigits(e.target.value))}
                        onBlur={lookUp}
                        {...PLAIN}
                      />
                    </Field>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("user")} htmlFor="user">
                    <Input
                      id="user"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      onBlur={lookUp}
                      {...PLAIN}
                    />
                  </Field>
                  <Field label={t("password")} htmlFor="password" hint={t("passwordHint")}>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={lookUp}
                    />
                  </Field>
                </div>
                <Field
                  label={t("database")}
                  htmlFor="database"
                  error={listed?.refused || undefined}
                  hint={
                    looking
                      ? t("databaseLooking")
                      : pickDatabase && !listed
                        ? t("databaseWaiting")
                        : listed && !listed.refused && listed.databases.length === 0
                          ? t("databaseNone")
                          : picked.key === "generic-trino"
                            ? t("databaseHintTrino")
                            : undefined
                  }
                >
                  {pickDatabase ? (
                    <Select value={database} onValueChange={setDatabase} disabled={!listed}>
                      <SelectTrigger id="database">
                        <SelectValue placeholder={t("databasePick")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(listed?.databases ?? []).map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="database"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      {...PLAIN}
                    />
                  )}
                </Field>
              </>
            )}

            {picked && (
              <>
                <Field
                  label={t("name")}
                  htmlFor="name"
                  hint={name ? t("technicalName", { name }) : t("nameHint")}
                >
                  <Input
                    id="name"
                    value={named ? label : name}
                    onChange={(e) => {
                      setNamed(true);
                      setLabel(e.target.value);
                    }}
                    {...PLAIN}
                  />
                </Field>
                {sibling && <p className="text-muted-foreground text-xs">{t("anotherTwenty")}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={!ready || busy}>
                    {picked.kind === "database"
                      ? t(busy ? "adding" : "addAndDiscover")
                      : t(busy ? "connecting" : "connect")}
                  </Button>
                </div>
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
