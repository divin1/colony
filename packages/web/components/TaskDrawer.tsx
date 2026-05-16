"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatRelative, formatDuration } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Task, TaskStatus, AntStatusEntry } from "@/lib/types";
import { Bot, User, GitBranch, CheckCircle, RotateCcw } from "lucide-react";

const STATUS_BADGE: Record<TaskStatus, "secondary" | "info" | "warning" | "success" | "outline"> = {
  backlog: "outline",
  todo: "secondary",
  in_progress: "info",
  in_review: "warning",
  done: "success",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export function TaskDrawer({
  task,
  open,
  ants,
  onClose,
}: {
  task: Task | null;
  open: boolean;
  ants: AntStatusEntry[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["comments", task?.id],
    queryFn: () => api.commentList(task!.id),
    enabled: !!task,
  });

  const patchMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.taskPatch>[1]) => api.taskPatch(task!.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: () => api.commentAdd(task!.id, "Human", newComment.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", task?.id] });
      setNewComment("");
    },
  });

  const assigneeMutation = useMutation({
    mutationFn: (patch: { assigneeType: "ant" | "human"; assigneeName?: string | null }) =>
      api.taskPatch(task!.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  if (!task) return null;

  const duration =
    task.startedAt && task.completedAt
      ? formatDuration(task.startedAt, task.completedAt)
      : task.startedAt ? formatDuration(task.startedAt) : null;

  const canApprove = task.status === "in_review";
  const canRequeue = task.status === "in_review" || task.status === "done";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base leading-snug">{task.title}</SheetTitle>
              <SheetDescription className="mt-1">
                {task.source} · {formatRelative(task.createdAt)}
              </SheetDescription>
            </div>
            <Badge variant={STATUS_BADGE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {/* Assignee selector */}
            <select
              className="h-7 text-xs rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              value={
                task.assigneeType === "human"
                  ? "human"
                  : task.assigneeName ?? ""
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "human") {
                  assigneeMutation.mutate({ assigneeType: "human", assigneeName: null });
                } else {
                  assigneeMutation.mutate({ assigneeType: "ant", assigneeName: val });
                }
              }}
            >
              <option value="human">👤 Human</option>
              {ants.map((a) => (
                <option key={a.name} value={a.name}>
                  🐜 {a.name}
                </option>
              ))}
            </select>

            {duration && (
              <span className="text-xs text-muted-foreground">Duration: {duration}</span>
            )}

            {/* Quick actions */}
            <div className="ml-auto flex gap-2">
              {canApprove && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 text-success border-success/30 hover:bg-success/10"
                  onClick={() => patchMutation.mutate({ status: "done" })}
                  disabled={patchMutation.isPending}
                >
                  <CheckCircle className="size-3" /> Approve
                </Button>
              )}
              {canRequeue && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => patchMutation.mutate({ status: "todo" })}
                  disabled={patchMutation.isPending}
                >
                  <RotateCcw className="size-3" /> Re-queue
                </Button>
              )}
              {task.status === "backlog" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => patchMutation.mutate({ status: "todo" })}
                  disabled={patchMutation.isPending}
                >
                  Move to To Do
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Description */}
          {task.description && (
            <>
              <div className="px-6 py-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</p>
              </div>
              <ScrollArea className="h-32">
                <pre className="px-6 py-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {task.description}
                </pre>
              </ScrollArea>
              <Separator />
            </>
          )}

          {/* Last output */}
          {task.lastOutput && (
            <>
              <div className="px-6 py-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Summary</p>
              </div>
              <ScrollArea className="h-28">
                <p className="px-6 py-3 text-sm whitespace-pre-wrap">{task.lastOutput}</p>
              </ScrollArea>
              <Separator />
            </>
          )}

          {/* GitHub issue link */}
          {task.issueContext && (
            <div className="px-6 py-2 border-b border-border text-xs text-muted-foreground flex items-center gap-1">
              <GitBranch className="size-3" />
              <a
                href={`https://github.com/${task.issueContext.owner}/${task.issueContext.repo}/issues/${task.issueContext.number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                {task.issueContext.repoSlug}#{task.issueContext.number}
              </a>
            </div>
          )}

          {/* Comments */}
          <div className="px-6 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Comments {comments.length > 0 && `(${comments.length})`}
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-6 py-3 flex flex-col gap-3">
              {comments.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No comments yet.</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {c.author === "Human" || !ants.find((a) => a.name === c.author) ? (
                      <User className="size-3" />
                    ) : (
                      <Bot className="size-3" />
                    )}
                    <span className="font-medium">{c.author}</span>
                    <span className="ml-auto">{formatRelative(c.createdAt)}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-snug pl-4">{c.body}</p>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Add comment */}
          <div className="px-6 py-3 border-t border-border flex gap-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment…"
              rows={2}
              className="text-sm resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  if (newComment.trim()) commentMutation.mutate();
                }
              }}
            />
            <Button
              size="sm"
              disabled={!newComment.trim() || commentMutation.isPending}
              onClick={() => commentMutation.mutate()}
            >
              Post
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
