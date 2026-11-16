"use client";

import { useState } from "react";
import { Card, PageHeader } from "@/components/shell/page-header";
import { RunError, useRun } from "@/components/shell/stub-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActions } from "@/lib/data";
import config from "@/lib/iblai/config";
import { installCommand } from "@/lib/setup-link";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { error, run } = useRun();
  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <span className="text-right">
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </Button>
      <RunError error={error} />
    </span>
  );
}

/** No server connected for this platform in this browser: name one, or install one. */
export function ConnectServer() {
  const actions = useActions();
  const { busy, error, run } = useRun();
  const [host, setHost] = useState("");
  const command = installCommand({
    host,
    frontend: window.location.origin,
    platformUrl: config.dmUrl(),
  });

  const connect = () =>
    run(async () => {
      await actions.connectServer(host);
      window.location.reload();
    });

  return (
    <>
      <PageHeader
        title="Connect a server"
        description="This platform has no ontology server connected in this browser yet."
      />
      <div className="max-w-2xl space-y-4">
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <Label htmlFor="server-host" className="mb-1.5 text-gray-700">
              Host name
            </Label>
            <div className="flex gap-2">
              <Input
                id="server-host"
                className="mono h-9"
                value={host}
                placeholder="ontology.university.edu"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setHost(e.target.value)}
              />
              <Button
                type="submit"
                size="lg"
                className="ibl-button-primary"
                disabled={busy || !host.trim()}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
            </div>
            <RunError error={error} />
          </form>
        </Card>

        <Card>
          <div className="mb-2.5 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Install one</h3>
              <p className="mt-1 text-[12.5px] text-gray-600">
                On a fresh Ubuntu server of yours (22.04, 24.04 or 26.04), with a host name that
                points to it and ports 80 and 443 open. It ends with a link: open it to finish.
              </p>
            </div>
            <CopyButton text={command} />
          </div>
          <pre className="mono overflow-auto rounded-lg border border-[var(--border-color)] bg-[#fafbfc] p-3.5 text-[12px] leading-[1.55] text-gray-700">
            {command}
          </pre>
        </Card>
      </div>
    </>
  );
}
