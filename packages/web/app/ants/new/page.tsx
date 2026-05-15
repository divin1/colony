"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { NewAntForm } from "@/components/NewAntForm";
import { api } from "@/lib/api";
import { ChevronLeft } from "lucide-react";

export default function NewAntPage() {
  const { data } = useQuery({ queryKey: ["status"], queryFn: api.status });

  return (
    <div className="min-h-screen flex flex-col">
      <Nav colonyName={data?.colony} />
      <main className="flex-1 p-5 max-w-3xl mx-auto w-full">
        <Link
          href="/ants"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-5"
        >
          <ChevronLeft className="size-3" /> Ants
        </Link>
        <h1 className="text-lg font-semibold mb-6">New ant</h1>
        <NewAntForm />
      </main>
    </div>
  );
}
