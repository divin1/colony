"use client";

import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/Nav";
import { ColonyConfigEditor } from "@/components/ColonyConfigEditor";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ["status"], queryFn: api.status });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={data?.colony} />
      <main className="flex-1 p-5 max-w-3xl mx-auto w-full">
        <h1 className="text-lg font-semibold mb-6">Settings</h1>
        <ColonyConfigEditor />
      </main>
    </div>
  );
}
