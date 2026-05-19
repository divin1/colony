"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { ChevronLeft, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#64748b", // slate
];

interface FormState {
  name: string;
  description: string;
  color: string | null;
}

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.projectGet(id),
    retry: false,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (project && !dirty) {
      setForm({ name: project.name, description: project.description, color: project.color });
    }
  }, [project, dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.projectUpdate(id, {
        name: form!.name.trim(),
        description: form!.description,
        color: form!.color,
      }),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.projectDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav colonyName={status?.colony} />
        <main className="flex-1 p-5 max-w-2xl mx-auto w-full">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav colonyName={status?.colony} />
        <main className="flex-1 p-5 max-w-2xl mx-auto w-full">
          <p className="text-sm text-muted-foreground">Project not found.</p>
        </main>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-3" /> Board
          </Link>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            <Save className="size-3.5" />
            {saveMutation.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </div>

        <div>
          <h1 className="text-lg font-semibold">Project settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{project.name}</p>
        </div>

        <Separator />

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Name</label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Project name"
            className="max-w-sm"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Description</label>
          <Input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What is this project about?"
            className="max-w-lg"
          />
        </div>

        {/* Color */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Color</label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("color", form.color === c ? null : c)}
                className={cn(
                  "size-6 rounded-full transition-all",
                  form.color === c
                    ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110"
                    : "opacity-70 hover:opacity-100"
                )}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
            {form.color && !PRESET_COLORS.includes(form.color) && (
              <button
                type="button"
                onClick={() => set("color", null)}
                className="size-6 rounded-full ring-2 ring-offset-2 ring-offset-background ring-white scale-110"
                style={{ background: form.color }}
                aria-label="Current color"
              />
            )}
            {form.color && (
              <button
                type="button"
                onClick={() => set("color", null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {saveMutation.isError && (
          <p className="text-xs text-destructive">
            {(saveMutation.error as Error).message}
          </p>
        )}

        <Separator />

        {/* Danger zone */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Danger zone
          </p>
          {!confirmDelete ? (
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-medium">Delete this project</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Removes the project and all its tasks permanently.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-danger border-danger/30 hover:bg-danger/10 shrink-0"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" />
                Delete project
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-danger/40 bg-danger/5 p-4">
              <p className="text-sm text-danger">
                Delete <strong>{project.name}</strong>? This cannot be undone.
              </p>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
