"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/Nav";
import { AntCard } from "@/components/AntCard";
import { AddWorkModal } from "@/components/AddWorkModal";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Plus } from "lucide-react";

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
          {data && data.ants.length > 0 && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" />
              Assign work
            </Button>
          )}
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {data && (
          <>
            {data.ants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ants configured.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {data.ants.map((ant) => (
                  <AntCard key={ant.name} ant={ant} />
                ))}
              </div>
            )}
            <AddWorkModal
              ants={data.ants}
              open={addOpen}
              onClose={() => setAddOpen(false)}
            />
          </>
        )}
      </main>
    </div>
  );
}
