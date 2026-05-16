"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { AntStatusEntry, Project, TaskStatus } from "@/lib/types";

export function AddTaskModal({
  open,
  onClose,
  projects,
  defaultProjectId,
  ants,
  defaultStatus = "backlog",
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  defaultProjectId?: string;
  ants: AntStatusEntry[];
  defaultStatus?: TaskStatus;
}) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeType, setAssigneeType] = useState<"ant" | "human">("ant");
  const [assigneeName, setAssigneeName] = useState(ants[0]?.name ?? "");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);

  const mutation = useMutation({
    mutationFn: () =>
      api.taskCreate({
        projectId,
        title: title.trim(),
        description: description.trim(),
        assigneeType,
        assigneeName: assigneeType === "ant" ? assigneeName : undefined,
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setTitle("");
      setDescription("");
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Project */}
          {projects.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short task title…"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed instructions for the ant…"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(e as never);
              }}
            />
          </div>

          {/* Assignee */}
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-sm text-muted-foreground">Assign to</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAssigneeType("ant")}
                  className={`flex-1 h-9 rounded-md border text-sm transition-colors ${
                    assigneeType === "ant"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  🐜 Ant
                </button>
                <button
                  type="button"
                  onClick={() => setAssigneeType("human")}
                  className={`flex-1 h-9 rounded-md border text-sm transition-colors ${
                    assigneeType === "human"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  👤 Human
                </button>
              </div>
            </div>

            {assigneeType === "ant" && ants.length > 0 && (
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-sm text-muted-foreground">Ant</label>
                <select
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {ants.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Initial status */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Start in</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="backlog">Backlog (staging)</option>
              <option value="todo">To Do (ready for ant)</option>
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={!title.trim() || !projectId || mutation.isPending}
            >
              {mutation.isPending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
