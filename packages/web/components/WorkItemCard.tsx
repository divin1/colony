"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatRelative } from "@/lib/utils";
import type { PersistedWorkItem, WorkItemSource, WorkItemStatus } from "@/lib/types";
import { GitBranch, MessageSquare, Clock, Terminal, User } from "lucide-react";

const SOURCE_ICONS: Record<WorkItemSource, React.ComponentType<{ className?: string }>> = {
  github_issue: GitBranch,
  discord: MessageSquare,
  cron: Clock,
  manual: User,
};

const SOURCE_LABELS: Record<WorkItemSource, string> = {
  github_issue: "GitHub",
  discord: "Discord",
  cron: "Cron",
  manual: "Manual",
};

const STATUS_VARIANT: Record<WorkItemStatus, "success" | "info" | "warning" | "danger" | "secondary" | "outline"> = {
  queued: "secondary",
  running: "info",
  done: "success",
  failed: "danger",
  cancelled: "outline",
};

export function WorkItemCard({
  item,
  onClick,
}: {
  item: PersistedWorkItem;
  onClick: () => void;
}) {
  const SourceIcon = SOURCE_ICONS[item.source];

  return (
    <Card
      className="p-3 cursor-pointer hover:border-muted-foreground/30 transition-colors group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-foreground">
          {item.title}
        </p>
        <Badge variant={STATUS_VARIANT[item.status]} className="shrink-0 text-[10px] px-1.5 py-0">
          {item.status}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="bg-secondary px-1.5 py-0.5 rounded text-[10px] font-mono">
          {item.antName}
        </span>
        <span className="flex items-center gap-0.5">
          <SourceIcon className="size-3" />
          {SOURCE_LABELS[item.source]}
        </span>
        <span className="ml-auto">{formatRelative(item.createdAt)}</span>
      </div>
    </Card>
  );
}
