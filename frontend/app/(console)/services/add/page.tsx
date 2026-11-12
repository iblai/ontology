"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import { CATALOG } from "@/lib/ontology/catalog";
import {
  CONNECTABLE,
  TWENTY_CLOUD,
  connectable,
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
  const [host, setHost] = useState("");
  const [port, setPort] = useState(from?.port ? String(from.port) : "");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [name, setName] = useState(from?.kind === "twenty" ? from.key : "");
  // A name that was typed no longer follows the system or the database.
  const [named, setNamed] = useState(false);
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
    setPort(next?.port ? String(next.port) : "");
    setDatabase("");
    setFound(undefined);
    if (!named) setName(next?.kind === "twenty" ? next.key : "");
  }

  function chooseDatabase(value: string) {
    setDatabase(value);
    if (!named) setName(systemName(value));
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
      if (res.ok && res.databases.length === 1) chooseDatabase(res.databases[0]);
    } catch (err) {
      setFound({ login, databases: [], refused: err instanceof Error ? err.message : String(err) });
    } finally {
      setLooking(false);
    }
  }

  const nameOk = /^[a-z0-9][a-z0-9-]*$/.test(name);
  const ready =
    nameOk &&
    (picked?.kind === "twenty"
      ? apiKey.trim() !== "" && (hosting === "cloud" || twentyAddress(address))
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
              service_type: "api",
              adapter: picked.adapter,
              host: hosting === "cloud" ? TWENTY_CLOUD : address.trim(),
              api_key: apiKey.trim(),
              domain,
            }
          : {
              name,
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
    group: c.kind === "twenty" ? t("groupApplications") : t("groupDatabases"),
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
                    <Select value={database} onValueChange={chooseDatabase} disabled={!listed}>
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
                      onChange={(e) => chooseDatabase(e.target.value)}
                      {...PLAIN}
                    />
                  )}
                </Field>
              </>
            )}

            {picked && (
              <>
                <Field label={t("name")} htmlFor="name" hint={t("nameHint")}>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => {
                      setNamed(true);
                      setName(systemName(e.target.value));
                    }}
                    {...PLAIN}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={!ready || busy}>
                    {picked.kind === "twenty"
                      ? t(busy ? "connecting" : "connect")
                      : t(busy ? "adding" : "addAndDiscover")}
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
