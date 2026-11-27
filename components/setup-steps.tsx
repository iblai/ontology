"use client";

// The "?" beside a Google or Microsoft tile's sign-in fields: where each value comes from.
// Its motion, copy buttons and scroll shadows are the sp-* rules in app/globals.css.

import { useRef, useState, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import { Popover } from "@base-ui/react/popover";
import { ArrowUpRight, Check, ChevronDown, CircleQuestionMark, Copy, X } from "lucide-react";
import { apiPage, scopeLine, setup, type Setup } from "@/lib/library/setup";
import { catalog } from "@/lib/view/catalog";

const QUICK_SETUP =
  "https://console.cloud.google.com/auth/overview/personal?apis=ws,wsmcp,tasksmcp&clientType=web&isAgent=true";
const PLAYGROUND = "https://developers.google.com/oauthplayground";
const TOKEN_URL = "https://login.microsoftonline.com/your-directory-id/oauth2/v2.0/token";
const GUIDES = "https://github.com/iblai/ontology/blob/main/docs/guides";

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group text-[#0058cc] underline-offset-2 hover:underline"
    >
      {children}
      <ArrowUpRight
        className="ml-0.5 inline size-3 align-[-1px] motion-safe:transition-transform motion-safe:group-hover:translate-x-px motion-safe:group-hover:-translate-y-px"
        aria-hidden
      />
    </a>
  );
}

// A name on the vendor's own screen.
function B({ children }: { children: ReactNode }) {
  return <b className="font-medium text-gray-900">{children}</b>;
}

// VoiceOver skips a message identical to the last one, so a repeat gets a no-break space.
let lastMessage = "";

function CopyValue({ value, what }: { value: string; what: string }) {
  const [done, setDone] = useState<{ ok: boolean; message: string; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copy = async () => {
    clearTimeout(timer.current);
    let ok = true;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      ok = false;
    }
    let message = ok ? "Copied" : "Copy failed";
    if (message === lastMessage) message += "\u00A0";
    lastMessage = message;
    setDone((d) => ({ ok, message, n: (d?.n ?? 0) + 1 }));
    timer.current = setTimeout(() => setDone(null), 2000);
  };
  return (
    <span className="my-2 flex items-start gap-2">
      <code className="mono min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[#fafbfc] px-2 py-1.5 text-[11px] leading-snug break-all text-gray-800">
        {value}
      </code>
      <span className="relative shrink-0">
        <button
          type="button"
          aria-label={`Copy ${what}`}
          onClick={() => void copy()}
          className="grid min-h-7 min-w-7 place-items-center rounded-md border border-[var(--border-color)] bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900"
        >
          {done?.ok ? (
            <Check key={done.n} className="sp-copied size-3.5 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
        <output className="sp-tip pointer-events-none absolute right-0 bottom-full mb-1 rounded-md bg-gray-900 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white">
          {done?.message ?? ""}
        </output>
      </span>
    </span>
  );
}

function Names({ names }: { names: string[] }) {
  return (
    <ul className="mono my-2 space-y-0.5 border-l-2 border-[var(--border-color)] pl-2.5 text-[11.5px] text-gray-800">
      {names.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function GoogleSteps({ s }: { s: Extract<Setup, { vendor: "google" }> }) {
  return (
    <ol className="sp-steps">
      <li>
        Signed in to Google as {s.account ?? "the account agents will use"}, open{" "}
        <Out href={QUICK_SETUP}>Google’s quick setup</Out>. Create a project, name the client, add
        this redirect address, keep <B>Use this client for an AI-powered agent</B> ticked, agree and
        press <B>Continue</B>:
        <CopyValue value={PLAYGROUND} what="the redirect address" />
        Put the <B>Client ID</B> and <B>Client Secret</B> it shows in the fields.
        <details className="sp-more mt-2 text-xs text-gray-600">
          <summary className="text-gray-500 hover:text-gray-900">
            <ChevronDown className="size-3.5" aria-hidden />
            Setting it up for someone else’s account?
          </summary>
          <p className="pt-1.5">
            The quick setup serves only the account that creates it. Instead, create a project in{" "}
            <Out href="https://console.cloud.google.com">Google Cloud</Out>, open{" "}
            <B>Google Auth Platform</B> and choose <B>Internal</B> as the audience, then under{" "}
            <B>Clients</B> create a <B>Web application</B> client with the same redirect address.
          </p>
        </details>
      </li>
      <li>
        Turn on the <Out href={apiPage(s.service)}>{s.api}</Out> if it is off.
      </li>
      <li>
        In the <Out href={PLAYGROUND}>OAuth 2.0 Playground</Out>, press the gear, tick{" "}
        <B>Use your own OAuth credentials</B> and paste the Client ID and Client Secret. Paste these
        scopes, press <B>Authorize APIs</B> and sign in:
        <CopyValue value={scopeLine(s.scopes)} what="the scopes" />
        Press <B>Exchange authorization code for tokens</B> and put the <B>Refresh token</B> in its
        field.
      </li>
    </ol>
  );
}

function MicrosoftSteps({ s }: { s: Extract<Setup, { vendor: "microsoft" }> }) {
  return (
    <ol className="sp-steps">
      <li>
        In the <Out href="https://entra.microsoft.com">Microsoft Entra admin center</Out>, open{" "}
        <B>App registrations</B> and press <B>New registration</B>. Put its{" "}
        <B>Application (client) ID</B> in Client ID, and this in Token URL, with its{" "}
        <B>Directory (tenant) ID</B> in place of your-directory-id:
        <CopyValue value={TOKEN_URL} what="the token address" />
      </li>
      <li>
        Under <B>Certificates &amp; secrets</B>, press <B>New client secret</B> and put its{" "}
        <B>Value</B> in Client Secret. Microsoft shows it only once.
      </li>
      <li>
        Under <B>API permissions</B>, press <B>Add a permission</B>, then <B>Microsoft Graph</B>,
        then <B>Application permissions</B>, and add:
        <Names names={s.permissions} />
        {s.writes.length > 0 && (
          <>
            Only if agents may write, also:
            <Names names={s.writes} />
          </>
        )}
        Then press <B>Grant admin consent</B>.
      </li>
    </ol>
  );
}

/** Nothing for a tile that signs in neither with Google nor with Microsoft. */
export function SetupHelp({
  id,
  name,
  anchor,
}: {
  id: string;
  name: string;
  anchor: RefObject<HTMLElement | null>; // the steps open beside it, clear of the fields
}) {
  const [open, setOpen] = useState(false);
  const s = setup[id];
  if (!s) return null;
  const logo = catalog.find((kind) => kind.ready === id)?.logo;
  const guide =
    s.vendor === "google"
      ? `${GUIDES}/connect-google-workspace.md`
      : `${GUIDES}/connect-microsoft-365.md`;
  return (
    <Popover.Root
      open={open}
      // Stays open while the fields are filled in: the ?, Escape or × close it.
      onOpenChange={(next, d) => {
        if (!next && (d.reason === "outside-press" || d.reason === "focus-out")) return;
        setOpen(next);
      }}
    >
      <Popover.Trigger
        className="text-gray-400 hover:text-gray-700 data-popup-open:text-gray-900"
        aria-label={`How to get these for ${name}`}
      >
        <CircleQuestionMark className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="left"
          align="start"
          sideOffset={28}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
          className="isolate z-50"
        >
          <Popover.Popup
            // Focus moves into the steps for the keyboard only, so a click rings no link.
            initialFocus={(type) => type === "keyboard"}
            className="sp-pop flex max-h-[min(72vh,600px)] w-[360px] flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-white text-[13px] leading-relaxed text-gray-700 shadow-[0_1px_2px_rgb(16_24_40/0.05),0_16px_36px_-12px_rgb(16_24_40/0.22)] outline-none"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--border-color)] px-4 py-3">
              {logo && (
                <Image src={logo} alt="" width={20} height={20} className="size-5 object-contain" />
              )}
              <Popover.Title className="flex-1 text-sm font-semibold text-gray-900">
                Connect {name}
              </Popover.Title>
              <Popover.Close
                aria-label="Close"
                className="grid size-6 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="size-4" />
              </Popover.Close>
            </div>
            <div className="sp-scroll min-h-0 px-4 py-3.5">
              {s.vendor === "google" ? <GoogleSteps s={s} /> : <MicrosoftSteps s={s} />}
            </div>
            <div className="border-t border-[var(--border-color)] px-4 py-2.5 text-xs">
              <Out href={guide}>Full guide</Out>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
