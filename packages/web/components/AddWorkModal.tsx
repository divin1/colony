"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { AntStatusEntry } from "@/lib/types";

export function AddWorkModal({
  ants,
  defaultAnt,
  open,
  onClose,
}: {
  ants: AntStatusEntry[];
  defaultAnt?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [selectedAnt, setSelectedAnt] = useState(defaultAnt ?? ants[0]?.name ?? "");
  const [prompt, setPrompt] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.antPrompt(selectedAnt, prompt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      setPrompt("");
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !selectedAnt) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign work</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {ants.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground">Ant</label>
              <select
                value={selectedAnt}
                onChange={(e) => setSelectedAnt(e.target.value)}
                className="h-9 rounded-md border border-input bg-input px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {ants.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground">Work instruction</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what this ant should do…"
              rows={5}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(e as never);
              }}
            />
            <p className="text-xs text-muted-foreground">⌘↵ to submit</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!prompt.trim() || !selectedAnt || mutation.isPending}>
              {mutation.isPending ? "Sending…" : "Assign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
