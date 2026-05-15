"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { AntCard } from "@/components/AntCard";
import { AddWorkModal } from "@/components/AddWorkModal";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Plus, Bug } from "lucide-react";

export default function AntsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["status"],
    queryFn: api.status,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={data?.colony} />
      <main className="flex-1 p-5">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-semibold">Ants</h1>
          <div className="flex items-center gap-2">
            {data && data.ants.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                Assign work
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

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {data && (
          <>
            {data.ants.length === 0 ? (
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
                {data.ants.map((ant) => (
                  <AntCard key={ant.name} ant={ant} />
                ))}
              </div>
            )}
            {data.ants.length > 0 && (
              <AddWorkModal
                ants={data.ants}
                open={addOpen}
                onClose={() => setAddOpen(false)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
