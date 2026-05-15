"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function lineClass(text: string): string {
  if (/^(✅|🐜)/.test(text)) return "text-success";
  if (/^(❌|💳|🔐|💰|🚫)/.test(text)) return "text-danger";
  if (/^(⏳|⏸️|▶️|⚙️)/.test(text)) return "text-muted-foreground italic";
  return "text-muted-foreground";
}

export function LiveOutput({ antName, initialLines }: { antName: string; initialLines: string[] }) {
  const [lines, setLines] = useState<string[]>(initialLines);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const es = new EventSource(`/api/ants/${encodeURIComponent(antName)}/output`);
    es.onmessage = (e) => {
      try {
        const { text } = JSON.parse(e.data as string) as { text: string };
        setLines((prev) => {
          const next = [...prev, text];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch {}
    };
    return () => es.close();
  }, [antName]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [lines, autoScroll]);

  return (
    <div className="relative">
      <ScrollArea
        className="h-80 rounded-md border border-border bg-background font-mono text-xs"
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
        ref={containerRef as never}
      >
        <div className="p-3 space-y-0.5">
          {lines.length === 0 ? (
            <p className="text-muted-foreground italic">No output yet…</p>
          ) : (
            lines.map((line, i) => (
              <p key={i} className={cn("leading-relaxed whitespace-pre-wrap break-words", lineClass(line))}>
                {line}
              </p>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ block: "nearest" });
          }}
          className="absolute bottom-2 right-4 text-xs text-info hover:underline"
        >
          Jump to bottom
        </button>
      )}
    </div>
  );
}
