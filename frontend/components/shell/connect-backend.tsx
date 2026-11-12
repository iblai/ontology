"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import config from "@/lib/iblai/config";
import { resolveAppTenant } from "@/lib/iblai/tenant";
import { apiClient } from "@/lib/ontology/api-client";
import { hostName, installCommand, validHost } from "@/lib/ontology/install";
import { CodeBlock } from "@/components/console/code-block";
import { Field, PLAIN } from "@/components/console/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Part({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-foreground text-sm font-medium">{title}</h2>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

/** Install a backend, make its key, keep its address in the platform: one column, top to bottom. */
export function ConnectBackend({
  current = "",
  onConnected,
}: {
  /** The address the platform keeps now, when there is one to replace. */
  current?: string;
  onConnected: (url: string) => void;
}) {
  const t = useTranslations("shell.connect");
  const [host, setHost] = useState("");
  const [address, setAddress] = useState(current);
  // An address that was typed no longer follows the host name, until it is emptied.
  const [typed, setTyped] = useState(current !== "");
  const [key, setKey] = useState("");
  const [keyRefused, setKeyRefused] = useState("");
  const [making, setMaking] = useState(false);
  const [refused, setRefused] = useState("");
  const [busy, setBusy] = useState(false);

  const name = hostName(host);
  const shown = typed ? address : validHost(name) ? `https://${name}` : "";
  const command = installCommand({
    platform: resolveAppTenant(),
    platformUrl: config.dmUrl(),
    host: name,
  });

  async function makeKey() {
    setMaking(true);
    setKeyRefused("");
    try {
      const res = await apiClient.hosted.key();
      if (res.ok) setKey(res.key);
      else setKeyRefused(res.message);
    } catch (e) {
      setKeyRefused(said(e));
    } finally {
      setMaking(false);
    }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefused("");
    try {
      const res = await apiClient.hosted.connect(shown.trim());
      if (res.ok) onConnected(res.url);
      else setRefused(res.message);
    } catch (err) {
      setRefused(said(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="flex flex-col gap-6 py-4">
        <section className="flex flex-col gap-3">
          <Part title={t("install")} hint={t("installHint")} />
          <Field
            label={t("host")}
            htmlFor="backend-host"
            error={host.trim() && !validHost(name) ? t("hostInvalid") : undefined}
          >
            <Input
              id="backend-host"
              inputMode="url"
              placeholder="ontology.example.edu"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              {...PLAIN}
            />
          </Field>
          <CodeBlock code={command} />
        </section>

        <section className="flex flex-col gap-3">
          <Part title={t("key")} hint={t("keyHint")} />
          {key ? (
            <>
              <CodeBlock code={key} />
              <p className="text-muted-foreground text-xs">{t("keyOnce")}</p>
            </>
          ) : (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={makeKey} disabled={making}>
                {t(making ? "keyCreating" : "keyCreate")}
              </Button>
            </div>
          )}
          {keyRefused && <p className="text-xs text-red-600">{keyRefused}</p>}
        </section>

        <form onSubmit={connect} className="flex flex-col gap-3" autoComplete="off">
          <Part title={t("connectTitle")} hint={t("connectHint")} />
          <Field label={t("address")} htmlFor="backend-address" error={refused || undefined}>
            <Input
              id="backend-address"
              type="url"
              inputMode="url"
              placeholder="https://ontology.example.edu"
              value={shown}
              onChange={(e) => {
                setTyped(e.target.value !== "");
                setAddress(e.target.value);
                setRefused("");
              }}
              {...PLAIN}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={!shown.trim() || busy}>
              {t(busy ? "connecting" : "connect")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
