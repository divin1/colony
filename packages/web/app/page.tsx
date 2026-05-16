"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/Nav";
import { KanbanBoard } from "@/components/KanbanBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

export default function BoardPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projectList,
    select: (data) => data,
  });

  // Auto-select first project when loaded
  const effectiveProjectId =
    selectedProjectId ?? projects[0]?.id;

  const createProject = useMutation({
    mutationFn: () => api.projectCreate(newProjectName.trim()),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(result.id);
      setNewProjectName("");
      setNewProjectOpen(false);
    },
  });

  const ants = status?.ants ?? [];

  return (
    <div className="min-h-screen flex flex-col">
      <Nav
        colonyName={status?.colony}
        projects={projects}
        selectedProjectId={effectiveProjectId}
        onProjectChange={setSelectedProjectId}
        onNewProject={() => setNewProjectOpen(true)}
      />

      <main className="flex-1 p-5">
        {projectsLoading && (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        )}

        {!projectsLoading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
            <p className="text-muted-foreground text-sm">
              No projects yet. Create one to start managing tasks.
            </p>
            <Button onClick={() => setNewProjectOpen(true)}>
              Create your first project
            </Button>
          </div>
        )}

        {!projectsLoading && projects.length > 0 && effectiveProjectId && (
          <KanbanBoard
            ants={ants}
            projects={projects}
            projectId={effectiveProjectId}
          />
        )}
      </main>

      {/* New project dialog */}
      <Dialog open={newProjectOpen} onOpenChange={(o) => !o && setNewProjectOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newProjectName.trim()) createProject.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name…"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNewProjectOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newProjectName.trim() || createProject.isPending}
              >
                {createProject.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
