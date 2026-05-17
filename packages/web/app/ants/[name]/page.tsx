"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { LiveOutput } from "@/components/LiveOutput";
import { TaskCard } from "@/components/TaskCard";
import { TaskDrawer } from "@/components/TaskDrawer";
import { AddTaskModal } from "@/components/AddTaskModal";
import { AntConfigEditor } from "@/components/AntConfigEditor";
import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatUptime } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronLeft, Pause, Play, Trash2, Plus, Monitor, Settings2, BrainCircuit } from "lucide-react";

type Tab = "monitor" | "config" | "memory";

function MemoryTab({ antName }: { antName: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["memory", antName],
    queryFn: () => api.antMemoryGet(antName),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.antMemoryClear(antName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memory", antName] }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const summary = data?.summary ?? null;

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">Session memory</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          The closing summary from the last completed session, prepended to the next session's prompt.
        </p>
      </div>

      {!summary ? (
        <div className="rounded-lg border border-border bg-secondary/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">No memory stored yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Memory is saved automatically at the end of each successful session.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/20 p-4 text-xs text-foreground font-mono leading-relaxed">
            {summary}
          </pre>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="text-danger border-danger/30 hover:bg-danger/10"
              onClick={() => {
                if (confirm(`Clear memory for ${antName}? The next session will start without context.`)) {
                  clearMutation.mutate();
                }
              }}
              disabled={clearMutation.isPending}
            >
              <Trash2 className="size-3.5" />
              {clearMutation.isPending ? "Clearing…" : "Clear memory"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AntDetailPage() {
  const params = useParams<{ name: string }>();
  const antName = decodeURIComponent(params.name);
  const [tab, setTab] = useState<Tab>("monitor");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["status"] });

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: api.projectList });
  const ant = status?.ants.find((a) => a.name === antName);

  const { data: recentTasks = [] } = useQuery({
    queryKey: ["tasks-ant", antName],
    queryFn: () => api.taskList({ assignee: antName, limit: 10 }),
  });

  const pauseMutation = useMutation({ mutationFn: () => api.antPause(antName), onSuccess: invalidate });
  const resumeMutation = useMutation({ mutationFn: () => api.antResume(antName), onSuccess: invalidate });
  const clearMutation = useMutation({ mutationFn: () => api.antClear(antName), onSuccess: invalidate });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5 max-w-5xl mx-auto w-full">

        <div className="mb-4">
          <Link href="/ants" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ChevronLeft className="size-3" /> Ants
          </Link>
          <div className="flex items-center gap-3">
            {ant && <StatusDot state={ant.state} className="size-3" />}
            <h1 className="text-xl font-semibold">{antName}</h1>
            {ant && <Badge variant="secondary" className="font-mono text-xs">{ant.engine}</Badge>}
          </div>
        </div>

        {ant && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="flex items-center gap-3 text-sm text-muted-foreground mr-4">
              <span>Uptime: {formatUptime(ant.startedAt)}</span>
              <Separator orientation="vertical" className="h-4" />
              <span>{ant.sessionsCompleted} done</span>
              <Separator orientation="vertical" className="h-4" />
              <span className={ant.sessionsCrashed > 0 ? "text-danger" : ""}>{ant.sessionsCrashed} failed</span>
              {ant.queueSize > 0 && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="text-warning">{ant.queueSize} queued</span>
                </>
              )}
            </div>

            {ant.state === "paused" ? (
              <Button size="sm" variant="outline" className="text-success border-success/30 hover:bg-success/10"
                onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                <Play className="size-3" /> Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="text-warning border-warning/30 hover:bg-warning/10"
                onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                <Pause className="size-3" /> Pause
              </Button>
            )}

            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-danger"
              onClick={() => { if (confirm(`Clear ${antName} queue?`)) clearMutation.mutate(); }}
              disabled={clearMutation.isPending}>
              <Trash2 className="size-3" /> Clear queue
            </Button>

            <Button size="sm" onClick={() => setAddOpen(true)} className="ml-auto">
              <Plus className="size-3" /> Assign task
            </Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-5">
          {([
            { id: "monitor", label: "Monitor", icon: Monitor },
            { id: "memory", label: "Memory", icon: BrainCircuit },
            { id: "config", label: "Config", icon: Settings2 },
          ] as { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[]).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
                tab === id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === "monitor" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Live output</CardTitle>
                </CardHeader>
                <CardContent>
                  <LiveOutput antName={antName} initialLines={ant?.recentOutput ?? []} />
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Recent tasks</CardTitle>
                  <Link href={`/work?assignee=${encodeURIComponent(antName)}`} className="text-xs text-info hover:underline">
                    View all
                  </Link>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="flex flex-col gap-2">
                    {recentTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No tasks yet.</p>
                    ) : (
                      recentTasks.map((task) => (
                        <TaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === "memory" && <MemoryTab antName={antName} />}

        {tab === "config" && <AntConfigEditor antName={antName} />}
      </main>

      <TaskDrawer task={selectedTask} open={selectedTask !== null} ants={status?.ants ?? []} onClose={() => setSelectedTask(null)} />

      <AddTaskModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projects={projects}
        ants={status?.ants ?? []}
        defaultStatus="todo"
      />
    </div>
  );
}
