"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatRelative, formatDuration } from "@/lib/utils";
import { api } from "@/lib/api";
import type { PersistedWorkItem } from "@/lib/types";
import { X } from "lucide-react";

export function WorkItemDrawer({
  item,
  open,
  onClose,
}: {
  item: PersistedWorkItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: () => api.workCancel(item!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work"] });
      onClose();
    },
  });

  if (!item) return null;

  const duration =
    item.startedAt && item.completedAt
      ? formatDuration(item.startedAt, item.completedAt)
      : item.startedAt
      ? formatDuration(item.startedAt)
      : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base leading-snug">{item.title}</SheetTitle>
              <SheetDescription className="mt-1">
                {item.antName} · {item.source} · {formatRelative(item.createdAt)}
              </SheetDescription>
            </div>
            <Badge
              variant={
                item.status === "done"
                  ? "success"
                  : item.status === "running"
                  ? "info"
                  : item.status === "failed"
                  ? "danger"
                  : item.status === "queued"
                  ? "secondary"
                  : "outline"
              }
            >
              {item.status}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-3">
            {item.startedAt && (
              <span>Started {formatRelative(item.startedAt)}</span>
            )}
            {duration && <span>Duration: {duration}</span>}
            {item.status === "queued" && (
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                <X className="size-3" />
                Cancel
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 flex flex-col gap-0 overflow-hidden">
          {item.lastOutput && (
            <>
              <div className="px-6 py-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Summary
                </p>
              </div>
              <ScrollArea className="h-40">
                <p className="px-6 py-3 text-sm whitespace-pre-wrap text-foreground">
                  {item.lastOutput}
                </p>
              </ScrollArea>
              <Separator />
            </>
          )}

          <div className="px-6 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Prompt
            </p>
          </div>
          <ScrollArea className="flex-1">
            <pre className="px-6 py-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {item.prompt}
            </pre>
          </ScrollArea>

          {item.issueContext && (
            <>
              <Separator />
              <div className="px-6 py-3 text-xs text-muted-foreground">
                <span className="font-medium">GitHub Issue:</span>{" "}
                <a
                  href={`https://github.com/${item.issueContext.owner}/${item.issueContext.repo}/issues/${item.issueContext.number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-info hover:underline"
                >
                  {item.issueContext.repoSlug}#{item.issueContext.number}
                </a>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
