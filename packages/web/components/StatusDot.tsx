import { cn } from "@/lib/utils";
import type { AntRuntimeState } from "@/lib/types";

const STATE_COLORS: Record<AntRuntimeState, string> = {
  starting: "bg-info animate-pulse",
  running: "bg-success",
  paused: "bg-warning",
  crashed: "bg-danger",
  backoff: "bg-orange animate-pulse",
};

export function StatusDot({ state, className }: { state: AntRuntimeState; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2 rounded-full flex-shrink-0", STATE_COLORS[state], className)}
      title={state}
    />
  );
}
