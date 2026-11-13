"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { clearCurrentTenantCookie, handleTenantSwitch } from "@iblai/iblai-js/web-utils";
import config from "@/lib/iblai/config";
import { resolveAppTenant } from "@/lib/iblai/tenant";
import { apiClient } from "@/lib/ontology/api-client";
import { addressOf, forgetSetup, noteSetupPlatform, type SetupLink } from "@/lib/ontology/install";
import { Field } from "@/components/console/form-dialog";
import { Picker } from "@/components/console/picker";
import { SectionHeader } from "@/components/console/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Platform = { key: string; label: string };

const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The platforms this user administers, as the SDK keeps them after sign-in. */
function administered(): Platform[] {
  try {
    const kept = JSON.parse(localStorage.getItem("tenants") ?? "[]") as Array<{
      key: string;
      is_admin?: boolean;
      name?: string;
      platform_name?: string;
    }>;
    return kept
      .filter((p) => p.is_admin)
      .map((p) => ({ key: p.key, label: p.name || p.platform_name || p.key }));
  } catch {
    return [];
  }
}

/** The SDK's own switch, as the profile menu's: back on the card, the platform is the one signed in to. */
function switchTo(platform: string) {
  noteSetupPlatform(platform);
  void handleTenantSwitch(platform, { authUrl: config.authUrl(), clearCurrentTenantCookie });
}

/** An install's link, opened: choose the platform the server is for, then set it up. */
export function SetupBackend({ link }: { link: SetupLink }) {
  const t = useTranslations("shell.setup");
  const [here] = useState(resolveAppTenant);
  const [mine] = useState(administered);
  const only = mine.length === 1 ? mine[0].key : "";
  // Chosen already when they came back from switching to it, or when there is no choice to make.
  const [chosen, setChosen] = useState(link.platform === here || only === here ? here : "");
  // A platform picked from the list that they are not signed in to yet.
  const [picked, setPicked] = useState("");
  const [refused, setRefused] = useState("");
  const [busy, setBusy] = useState(false);
  // The SDK starts no switch while its mark of one under way is set, and says nothing.
  const [stuck] = useState(() => document.cookie.includes("ibl_tenant_switching"));

  // The one platform they administer is not the one they are signed in to: switch to it, once.
  const mustSwitch = !stuck && only && only !== here && link.platform !== only ? only : "";
  const going = mustSwitch || picked;
  // A switch that did not take: they are back, still signed in to another platform.
  const missed = !going && link.platform && link.platform !== here ? link.platform : "";
  const named = (key: string) => mine.find((p) => p.key === key)?.label ?? key;

  useEffect(() => {
    // The code leaves the address bar once the link is kept.
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (mustSwitch) switchTo(mustSwitch);
  }, [mustSwitch]);

  function choose(key: string) {
    setRefused("");
    if (!key || key === here) return setChosen(key);
    if (stuck) return setRefused(t("switchBusy"));
    // A key is made in the platform of the sign-in that asks: nothing is sent to the server yet.
    setPicked(key);
    switchTo(key);
  }

  async function setUp() {
    if (busy) return;
    setBusy(true);
    setRefused("");
    try {
      const res = await apiClient.hosted.connect(addressOf(link.host), link.code);
      if (res.ok) {
        forgetSetup();
        // Loaded again, so every part of the console asks the backend that now answers.
        window.location.replace("/");
      } else setRefused(res.message);
    } catch (e) {
      setRefused(said(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    forgetSetup();
    window.location.replace("/");
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title", { host: link.host })}
        subtitle={t("hint", { host: link.host })}
      />
      <Card>
        <CardContent className="flex flex-col gap-6 py-4">
          <Field label={t("platform")} hint={mine.length ? t("platformHint") : undefined}>
            {going ? (
              <p className="text-muted-foreground text-sm">
                {t("switching", { platform: named(going) })}
              </p>
            ) : mine.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("none")}</p>
            ) : only === here ? (
              <p className="flex items-baseline gap-2">
                <span className="text-foreground text-sm">{mine[0].label}</span>
                {mine[0].label !== only && (
                  <span className="text-muted-foreground text-xs">{only}</span>
                )}
              </p>
            ) : (
              <Picker
                items={mine.map((p) => ({
                  value: p.key,
                  label: p.label,
                  hint: p.label === p.key ? undefined : p.key,
                }))}
                value={chosen}
                onChange={choose}
                label={t("platform")}
                placeholder={t("search")}
                empty={t("noneFound")}
                change={t("change")}
              />
            )}
          </Field>
          {(refused || missed) && (
            <p role="alert" className="text-xs text-red-600">
              {refused || t("notSwitched", { platform: named(missed) })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={setUp}
              disabled={!chosen || chosen !== here || busy || !!going}
            >
              {t(busy ? "settingUp" : "setUp")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
