"use client";

import { useState } from "react";
import { Card, PageHeader } from "@/components/shell/page-header";
import { RunError, useRun } from "@/components/shell/stub-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActions } from "@/lib/data";

const INSTALL_GUIDE = "https://github.com/iblai/ontology/blob/HEAD/docs/install.md";

/** No server connected for this platform in this browser: name one, or install one. */
export function ConnectServer() {
  const actions = useActions();
  const { busy, error, run } = useRun();
  const [host, setHost] = useState("");

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
          <h3 className="text-sm font-semibold text-gray-900">Install one</h3>
          <p className="mt-1 text-[12.5px] text-gray-600">
            An ontology server is installed on an Ubuntu server of the platform’s own (22.04, 24.04
            or 26.04): the console from source, NVIDIA’s engine in Docker. It serves its own console
            at its own address; connecting it here is only for a console hosted elsewhere, like this
            one.{" "}
            <a
              href={INSTALL_GUIDE}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-gray-900 underline underline-offset-2"
            >
              Read the install guide
            </a>
          </p>
        </Card>
      </div>
    </>
  );
}
