"use client";

import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/Nav";
import { KanbanBoard } from "@/components/KanbanBoard";
import { api } from "@/lib/api";

export default function BoardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["status"],
    queryFn: api.status,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={data?.colony} />
      <main className="flex-1 p-5">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Connecting to colony runner…</p>
        )}
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            Cannot connect to colony runner. Make sure <code className="font-mono">monitoring.port</code> is set
            and the runner is active.
          </div>
        )}
        {data && <KanbanBoard ants={data.ants} />}
      </main>
    </div>
  );
}
