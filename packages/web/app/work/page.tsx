"use client";

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Nav } from "@/components/Nav";
import { TaskDrawer } from "@/components/TaskDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Task, TaskStatus, TaskSource } from "@/lib/types";
import { formatRelative, formatDuration, cn } from "@/lib/utils";
import { MessageSquare, Clock, User, Bot } from "lucide-react";

const STATUS_VARIANT: Record<TaskStatus, "success" | "info" | "warning" | "danger" | "secondary" | "outline"> = {
  backlog: "outline",
  todo: "secondary",
  in_progress: "info",
  in_review: "warning",
  done: "success",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog", todo: "To Do", in_progress: "In Progress",
  in_review: "In Review", done: "Done",
};

const SOURCE_ICONS: Record<TaskSource, React.ComponentType<{ className?: string }>> = {
  discord: MessageSquare, cron: Clock, manual: User,
};

const ALL_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "done", "backlog"];

function TaskListContent() {
  const searchParams = useSearchParams();
  const assigneeFilter = searchParams.get("assignee") ?? undefined;
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: api.projectList });
  const ants = status?.ants ?? [];

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks-all", assigneeFilter, statusFilter, labelFilter],
    queryFn: () => api.taskList({
      assignee: assigneeFilter,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      label: labelFilter ?? undefined,
      limit: 300,
    }),
  });

  const toggleStatus = (s: TaskStatus) =>
    setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  // Collect all unique labels from loaded tasks (unfiltered view for filter chips)
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks-all", assigneeFilter],
    queryFn: () => api.taskList({ assignee: assigneeFilter, limit: 300 }),
  });
  const allLabels = [...new Set(allTasks.flatMap((t) => t.labels))].sort();

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5">
        <div className="mb-4">
          <h1 className="text-lg font-semibold mb-3">
            Tasks
            {assigneeFilter && (
              <span className="text-muted-foreground ml-2 font-normal text-base">· {assigneeFilter}</span>
            )}
          </h1>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((s) => (
              <Button
                key={s}
                variant={statusFilter.includes(s) ? "secondary" : "ghost"}
                size="sm"
                className={cn("text-xs h-7", statusFilter.includes(s) && "ring-1 ring-border")}
                onClick={() => toggleStatus(s)}
              >
                <Badge variant={STATUS_VARIANT[s]} className="mr-1 text-[10px] px-1 py-0">
                  {STATUS_LABEL[s]}
                </Badge>
                {tasks.filter((t) => t.status === s).length}
              </Button>
            ))}
          </div>
          {allLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {allLabels.map((l) => (
                <button
                  key={l}
                  onClick={() => setLabelFilter((prev) => prev === l ? null : l)}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                    labelFilter === l
                      ? "bg-secondary border-border text-foreground"
                      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks found.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card">
                  {["Title", "Project", "Assignee", "Source", "Status", "Created"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider first:pl-4 last:pr-4 hidden sm:table-cell first:table-cell last:table-cell">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => {
                  const SourceIcon = SOURCE_ICONS[task.source];
                  return (
                    <tr
                      key={task.id}
                      className={cn(
                        "border-b border-border cursor-pointer hover:bg-card/50 transition-colors",
                        i === tasks.length - 1 && "border-b-0"
                      )}
                      onClick={() => setSelectedTask(task)}
                    >
                      <td className="px-4 py-3">
                        <span className="line-clamp-1 max-w-[260px]">{task.title}</span>
                        {task.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {task.labels.map((l) => (
                              <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground leading-none">
                                {l}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                        {projectMap.get(task.projectId) ?? "—"}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {task.assigneeType === "ant" ? (
                          <span className="flex items-center gap-1 text-xs">
                            <Bot className="size-3" />
                            {task.assigneeName}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="size-3" /> Human
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <SourceIcon className="size-3" />
                          {task.source}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[task.status]} className="text-[10px] px-1.5 py-0">
                          {STATUS_LABEL[task.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatRelative(task.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <TaskDrawer
        task={selectedTask}
        open={selectedTask !== null}
        ants={ants}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

export default function TaskListPage() {
  return (
    <Suspense>
      <TaskListContent />
    </Suspense>
  );
}
