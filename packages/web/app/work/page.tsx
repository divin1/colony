"use client";

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Nav } from "@/components/Nav";
import { WorkItemDrawer } from "@/components/WorkItemDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { PersistedWorkItem, WorkItemStatus, WorkItemSource } from "@/lib/types";
import { formatRelative, formatDuration, cn } from "@/lib/utils";
import { GitBranch, MessageSquare, Clock, User } from "lucide-react";

const STATUS_VARIANT: Record<WorkItemStatus, "success" | "info" | "warning" | "danger" | "secondary" | "outline"> = {
  queued: "secondary",
  running: "info",
  done: "success",
  failed: "danger",
  cancelled: "outline",
};

const SOURCE_ICONS: Record<WorkItemSource, React.ComponentType<{ className?: string }>> = {
  github_issue: GitBranch,
  discord: MessageSquare,
  cron: Clock,
  manual: User,
};

const ALL_STATUSES: WorkItemStatus[] = ["queued", "running", "done", "failed", "cancelled"];

function WorkHistoryContent() {
  const searchParams = useSearchParams();
  const antFilter = searchParams.get("ant") ?? undefined;
  const [statusFilter, setStatusFilter] = useState<WorkItemStatus[]>([]);
  const [selectedItem, setSelectedItem] = useState<PersistedWorkItem | null>(null);

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });

  const { data: workItems = [], isLoading } = useQuery({
    queryKey: ["work", antFilter, statusFilter],
    queryFn: () =>
      api.workList({
        ant: antFilter,
        status: statusFilter.length > 0 ? statusFilter : undefined,
        limit: 200,
      }),
  });

  const toggleStatus = (s: WorkItemStatus) =>
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold">
            Work history{antFilter && <span className="text-muted-foreground ml-2 font-normal text-base">· {antFilter}</span>}
          </h1>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {ALL_STATUSES.map((s) => (
            <Button
              key={s}
              variant={statusFilter.includes(s) ? "secondary" : "ghost"}
              size="sm"
              className={cn("text-xs h-7", statusFilter.includes(s) && "ring-1 ring-border")}
              onClick={() => toggleStatus(s)}
            >
              <Badge variant={STATUS_VARIANT[s]} className="mr-1 text-[10px] px-1 py-0">
                {s}
              </Badge>
              {workItems.filter((i) => i.status === s).length}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : workItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work items found.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Title
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">
                    Ant
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden sm:table-cell">
                    Source
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">
                    Duration
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {workItems.map((item, i) => {
                  const SourceIcon = SOURCE_ICONS[item.source];
                  const duration =
                    item.startedAt && item.completedAt
                      ? formatDuration(item.startedAt, item.completedAt)
                      : item.startedAt
                      ? formatDuration(item.startedAt)
                      : "—";
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "border-b border-border cursor-pointer hover:bg-card/50 transition-colors",
                        i === workItems.length - 1 && "border-b-0"
                      )}
                      onClick={() => setSelectedItem(item)}
                    >
                      <td className="px-4 py-3">
                        <span className="line-clamp-1 max-w-[300px]">{item.title}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                          {item.antName}
                        </code>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="flex items-center gap-1 text-muted-foreground text-xs">
                          <SourceIcon className="size-3" />
                          {item.source}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[item.status]} className="text-[10px] px-1.5 py-0">
                          {item.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {duration}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatRelative(item.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <WorkItemDrawer
        item={selectedItem}
        open={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
      />
    </div>
  );
}

export default function WorkHistoryPage() {
  return (
    <Suspense>
      <WorkHistoryContent />
    </Suspense>
  );
}
