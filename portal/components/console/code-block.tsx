"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function CodeBlock({
  code,
  language,
  className,
  showCopy = true,
}: {
  code: string;
  language?: string;
  className?: string;
  showCopy?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={cn("group relative rounded-md border border-border bg-muted/40", className)}>
      {language && (
        <span className="absolute top-2 left-3 font-mono text-xs text-muted-foreground">{language}</span>
      )}
      {showCopy && (
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="absolute top-1 right-1 h-7 px-2 opacity-0 transition-opacity group-hover:opacity-100"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          <span className="sr-only">Copy</span>
        </Button>
      )}
      <pre
        className={cn(
          "overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground",
          language && "pt-8",
        )}
      >
        {code}
      </pre>
    </div>
  );
}