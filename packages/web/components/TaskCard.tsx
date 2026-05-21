"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";
import type { Task, TaskSource } from "@/lib/types";
import { MessageSquare, Clock, User, Bot } from "lucide-react";

const SOURCE_ICONS: Record<TaskSource, React.ComponentType<{ className?: string }>> = {
  discord: MessageSquare,
  cron: Clock,
  manual: User,
};

export function TaskCard({
  task,
  commentCount = 0,
  onClick,
}: {
  task: Task;
  commentCount?: number;
  onClick: () => void;
}) {
  const SourceIcon = SOURCE_ICONS[task.source];

  return (
    <Card
      className="p-3 cursor-pointer hover:border-muted-foreground/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-snug line-clamp-2">{task.title}</p>
        {task.priority === "high" && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-danger/15 text-danger leading-none">HIGH</span>
        )}
        {task.priority === "low" && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground leading-none">LOW</span>
        )}
      </div>
      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.labels.map((l) => (
            <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground leading-none">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        {task.assigneeType === "ant" && task.assigneeName ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
            <Bot className="size-2.5" />
            {task.assigneeName}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
            <User className="size-2.5" />
            Human
          </Badge>
        )}
        <span className="flex items-center gap-0.5">
          <SourceIcon className="size-3" />
          {task.source}
        </span>
        {commentCount > 0 && (
          <span className="flex items-center gap-0.5 ml-auto">
            <MessageSquare className="size-3" />
            {commentCount}
          </span>
        )}
        {commentCount === 0 && (
          <span className="ml-auto">{formatRelative(task.createdAt)}</span>
        )}
      </div>
    </Card>
  );
}
