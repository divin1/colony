"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { RotateCcw, AlertCircle, CheckCircle2 } from "lucide-react";

export function RestartBanner({ onDismiss }: { onDismiss: () => void }) {
  const queryClient = useQueryClient();
  const [reloadMsg, setReloadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reloadMutation = useMutation({
    mutationFn: api.reload,
    onSuccess: ({ added, removed, updated }) => {
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
      const parts = [
        added.length > 0 ? `${added.length} added` : "",
        removed.length > 0 ? `${removed.length} removed` : "",
        updated.length > 0 ? `${updated.length} updated` : "",
      ].filter(Boolean);
      setReloadMsg({ ok: true, text: parts.length > 0 ? parts.join(", ") : "no changes" });
    },
    onError: (err: Error) => {
      setReloadMsg({ ok: false, text: err.message });
    },
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
      <RotateCcw className="size-4 text-warning shrink-0" />
      <p className="text-sm text-warning flex-1">
        Config saved — restart the runner to apply changes.
      </p>

      {reloadMsg && (
        <span className={`flex items-center gap-1 text-xs ${reloadMsg.ok ? "text-success" : "text-danger"}`}>
          {reloadMsg.ok
            ? <><CheckCircle2 className="size-3.5" /> Reloaded ({reloadMsg.text})</>
            : <><AlertCircle className="size-3.5" /> {reloadMsg.text}</>
          }
        </span>
      )}

      {!reloadMsg && (
        <Button
          size="sm"
          variant="outline"
          className="text-warning border-warning/30 hover:bg-warning/10 shrink-0"
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
        >
          <RotateCcw className="size-3.5" />
          {reloadMutation.isPending ? "Reloading…" : "Reload now"}
        </Button>
      )}

      <button
        onClick={onDismiss}
        className="text-xs text-muted-foreground hover:text-foreground shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}
