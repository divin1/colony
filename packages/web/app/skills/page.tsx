"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { Plus, BookOpen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

const SKILL_TEMPLATE = `---
name: My Skill
description: Describe what this skill teaches the ant
---

## Context

Explain the domain or background the ant needs.

## Standards

List specific rules or patterns to follow.

## Examples

Provide concrete examples where helpful.
`;

export default function SkillsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: api.skillList,
  });

  const createSkill = useMutation({
    mutationFn: async () => {
      const filename = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      await api.skillSave(filename, SKILL_TEMPLATE.replace("My Skill", newName.trim()));
      return filename;
    },
    onSuccess: (filename) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setNewName("");
      setNewOpen(false);
      router.push(`/skills/${encodeURIComponent(filename + ".md")}`);
    },
  });

  const deleteSkill = useMutation({
    mutationFn: (filename: string) => api.skillDelete(filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold">Skills</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Reusable instruction files injected into ant sessions.
            </p>
          </div>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" /> New skill
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && skills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <BookOpen className="size-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium">No skills yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Skills are markdown files that add domain knowledge to any ant's session.
              </p>
            </div>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-3.5" /> Create first skill
            </Button>
          </div>
        )}

        {skills.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map((skill) => (
              <Card key={skill.filename} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/skills/${encodeURIComponent(skill.filename)}`}
                    className="text-sm font-medium hover:underline flex-1 min-w-0 truncate"
                  >
                    {skill.name}
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${skill.name}"?`)) deleteSkill.mutate(skill.filename);
                    }}
                    className="text-muted-foreground/40 hover:text-danger transition-colors flex-shrink-0"
                    aria-label="Delete skill"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {skill.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                )}
                <code className="text-[10px] text-muted-foreground/60 font-mono mt-auto">
                  skills/{skill.filename}
                </code>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={newOpen} onOpenChange={(o) => !o && setNewOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createSkill.mutate(); }}
            className="flex flex-col gap-4"
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Skill name (e.g. Code Review Standards)"
              autoFocus
            />
            <p className="text-xs text-muted-foreground -mt-2">
              Saved as <code>skills/{newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "…"}.md</code>
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!newName.trim() || createSkill.isPending}>
                {createSkill.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
