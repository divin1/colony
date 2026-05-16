"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { AntCard } from "@/components/AntCard";
import { AddTaskModal } from "@/components/AddTaskModal";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Plus, Bug } from "lucide-react";

export default function AntsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { data: status, isLoading } = useQuery({ queryKey: ["status"], queryFn: api.status });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: api.projectList });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={status?.colony} />
      <main className="flex-1 p-5">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-semibold">Ants</h1>
          <div className="flex items-center gap-2">
            {status && status.ants.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                Assign task
              </Button>
            )}
            <Button size="sm" asChild>
              <Link href="/ants/new">
                <Plus className="size-3.5" />
                New ant
              </Link>
            </Button>
          </div>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {status && (
          <>
            {status.ants.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <Bug className="size-10 text-muted-foreground/30" />
                <div>
                  <p className="text-sm font-medium">No ants running</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create an ant and restart the runner to get started.
                  </p>
                </div>
                <Button size="sm" asChild>
                  <Link href="/ants/new">
                    <Plus className="size-3.5" />
                    New ant
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {status.ants.map((ant) => (
                  <AntCard key={ant.name} ant={ant} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <AddTaskModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projects={projects}
        ants={status?.ants ?? []}
        defaultStatus="todo"
      />
    </div>
  );
}
