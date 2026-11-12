"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import config from "@/lib/iblai/config";
import { resolveAppTenant } from "@/lib/iblai/tenant";
import { apiClient } from "@/lib/ontology/api-client";
import { hostName, hostOf, installCommand, validHost } from "@/lib/ontology/install";
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

/** Name the backend's server, install it, make its key and connect: one column, top to bottom. */
export function ConnectBackend({
  current = "",
  onConnected,
}: {
  /** The address in use now, when there is one to replace. */
  current?: string;
  onConnected: (url: string) => void;
}) {
  const t = useTranslations("shell.connect");
  const [host, setHost] = useState(() => hostOf(current));
  // An address of its own, for a backend that is not at https://<host name>.
  const [address, setAddress] = useState(() => (hostOf(current) ? "" : current));
  // Advanced starts open only when there is such an address to show.
  const [advanced] = useState(address !== "");
  const [key, setKey] = useState("");
  const [keyRefused, setKeyRefused] = useState("");
  const [making, setMaking] = useState(false);
  const [refused, setRefused] = useState("");
  const [busy, setBusy] = useState(false);

  const name = hostName(host);
  const inferred = validHost(name) ? `https://${name}` : "";
  const target = address.trim() || inferred;
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
      const res = await apiClient.hosted.connect(target);
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
        <Field
          label={t("host")}
          htmlFor="backend-host"
          error={host.trim() && !validHost(name) ? t("hostInvalid") : undefined}
          hint={t("hostHint")}
        >
          <Input
            id="backend-host"
            // The one question asked: Enter in it connects, as in the form below.
            form="backend-connect"
            inputMode="url"
            placeholder="ontology.example.edu"
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              setRefused("");
            }}
            {...PLAIN}
          />
        </Field>

        <section className="flex flex-col gap-3">
          <Part title={t("install")} hint={t("installHint")} />
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

        {/* No browser check of the address: closed, Advanced could not show what it refused. */}
        <form
          id="backend-connect"
          onSubmit={connect}
          className="flex flex-col gap-3"
          autoComplete="off"
          noValidate
        >
          <Part title={t("connectTitle")} hint={t("connectHint")} />
          <details open={advanced || undefined}>
            <summary className="text-muted-foreground w-fit cursor-pointer text-xs select-none">
              {t("advanced")}
            </summary>
            <div className="pt-3">
              <Field label={t("address")} htmlFor="backend-address" hint={t("addressHint")}>
                <Input
                  id="backend-address"
                  type="url"
                  inputMode="url"
                  placeholder={inferred || "https://ontology.example.edu"}
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setRefused("");
                  }}
                  {...PLAIN}
                />
              </Field>
            </div>
          </details>
          {refused && (
            <p role="alert" className="text-xs text-red-600">
              {refused}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!target || busy}>
              {t(busy ? "connecting" : "connect")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
