"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/StatusDot";
import { formatUptime } from "@/lib/utils";
import { api } from "@/lib/api";
import type { AntStatusEntry } from "@/lib/types";
import { Pause, Play, Trash2 } from "lucide-react";

function CurrentTask({ taskId, state }: { taskId: string | null; state: AntStatusEntry["state"] }) {
  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.taskGet(taskId!),
    enabled: !!taskId && state === "running",
  });
  if (!taskId || state !== "running") return null;
  return (
    <p className="text-info truncate pt-0.5" title={task?.title}>
      {task?.title ?? "Loading task…"}
    </p>
  );
}

export function AntCard({ ant }: { ant: AntStatusEntry }) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["status"] });
  };

  const pauseMutation = useMutation({
    mutationFn: () => api.antPause(ant.name),
    onSuccess: invalidate,
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.antResume(ant.name),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: () => api.antClear(ant.name),
    onSuccess: invalidate,
  });

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <StatusDot state={ant.state} />
          <Link
            href={`/ants/${encodeURIComponent(ant.name)}`}
            className="font-semibold text-sm hover:text-info transition-colors"
          >
            {ant.name}
          </Link>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto font-mono">
            {ant.engine}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="py-2 text-xs text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Uptime</span>
          <span className="text-foreground">{formatUptime(ant.startedAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>Completed</span>
          <span className="text-foreground">{ant.sessionsCompleted}</span>
        </div>
        <div className="flex justify-between">
          <span>Failed</span>
          <span className={ant.sessionsCrashed > 0 ? "text-danger" : "text-foreground"}>
            {ant.sessionsCrashed}
          </span>
        </div>
        {ant.queueSize > 0 && (
          <div className="flex justify-between">
            <span>Queued</span>
            <span className="text-warning">{ant.queueSize}</span>
          </div>
        )}
        <CurrentTask taskId={ant.currentTaskId} state={ant.state} />
        {ant.lastError && (ant.state === "crashed" || ant.state === "backoff") && (
          <p className="text-danger truncate pt-0.5" title={ant.lastError}>
            {ant.lastError}
          </p>
        )}
      </CardContent>

      <CardFooter className="gap-2 pt-2">
        {ant.state === "paused" ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-success border-success/30 hover:bg-success/10"
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
          >
            <Play className="size-3" /> Resume
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-warning border-warning/30 hover:bg-warning/10"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending}
          >
            <Pause className="size-3" /> Pause
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-danger"
          onClick={() => {
            if (confirm(`Clear ${ant.name} queue?`)) clearMutation.mutate();
          }}
          disabled={clearMutation.isPending}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}
