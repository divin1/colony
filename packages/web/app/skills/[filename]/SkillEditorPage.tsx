"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ChevronLeft, Save, Trash2 } from "lucide-react";

export default function SkillEditorPage() {
  const params = useParams<{ filename: string }>();
  const filename = decodeURIComponent(params.filename);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: status } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: skillData, isLoading } = useQuery({
    queryKey: ["skill", filename],
    queryFn: () => api.skillGet(filename),
  });

  // Initialise editor once data arrives
  useEffect(() => {
    if (skillData && content === null) {
      setContent(skillData.content);
    }
  }, [skillData, content]);

  const saveMutation = useMutation({
    mutationFn: () => api.skillSave(filename, content ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skill", filename] });
      setDirty(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.skillDelete(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      router.push("/skills");
    },
  });

  const handleChange = (val: string) => {
    setContent(val);
    setDirty(true);
  };

  const skillPath = `skills/${filename}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5 max-w-4xl mx-auto w-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Link
            href="/skills"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-3" /> Skills
          </Link>
          <div className="flex items-center gap-2">
            <code className="text-xs text-muted-foreground/60 font-mono">{skillPath}</code>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-danger"
              onClick={() => {
                if (confirm(`Delete "${filename}"?`)) deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
            >
              <Save className="size-3.5" />
              {saveMutation.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
          </div>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && content !== null && (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            className="flex-1 min-h-[70vh] w-full rounded-lg border border-border bg-card px-4 py-3
                       font-mono text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring
                       leading-relaxed"
            placeholder="Write your skill here (frontmatter + markdown)…"
            onKeyDown={(e) => {
              if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (dirty) saveMutation.mutate();
              }
            }}
          />
        )}

        {!isLoading && content !== null && (
          <p className="text-xs text-muted-foreground">
            Reference this skill in an ant's config as{" "}
            <code className="font-mono">{skillPath}</code>.{" "}
            Use ⌘S / Ctrl+S to save.
          </p>
        )}
      </main>
    </div>
  );
}
