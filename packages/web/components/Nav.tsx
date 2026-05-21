"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Bug, ListTodo, BookOpen, Settings, ChevronDown, SlidersHorizontal } from "lucide-react";
import type { Project } from "@/lib/types";

const links = [
  { href: "/", label: "Board", icon: LayoutDashboard },
  { href: "/ants", label: "Ants", icon: Bug },
  { href: "/work", label: "Work", icon: ListTodo },
  { href: "/skills", label: "Skills", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({
  colonyName,
  projects,
  selectedProjectId,
  onProjectChange,
  onNewProject,
}: {
  colonyName?: string;
  projects?: Project[];
  selectedProjectId?: string;
  onProjectChange?: (id: string) => void;
  onNewProject?: () => void;
}) {
  const pathname = usePathname();
  const selectedProject = projects?.find((p) => p.id === selectedProjectId);

  return (
    <header className="border-b border-border bg-card sticky top-0 z-40">
      <div className="flex items-center gap-4 px-5 h-12">
        <div className="flex items-center gap-2 mr-2 shrink-0">
          <span className="text-base">🐜</span>
          <span className="font-semibold text-sm text-foreground">
            {colonyName ?? "Colony"}
          </span>
        </div>

        {/* Project switcher — only shown on board page when projects are available */}
        {projects && projects.length > 0 && onProjectChange && (
          <div className="flex items-center gap-1 border-l border-border pl-4">
            <ChevronDown className="size-3 text-muted-foreground" />
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  onNewProject?.();
                } else {
                  onProjectChange(e.target.value);
                }
              }}
              className="h-7 bg-transparent text-sm font-medium focus:outline-none cursor-pointer appearance-none pr-2"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {onNewProject && <option value="__new__">＋ New project…</option>}
            </select>
            {selectedProjectId && (
              <Link
                href={`/projects/${encodeURIComponent(selectedProjectId)}`}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                title="Project settings"
              >
                <SlidersHorizontal className="size-3" />
              </Link>
            )}
          </div>
        )}

        <nav className="flex items-center gap-0.5 ml-auto">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors",
                pathname === href || (href !== "/" && pathname.startsWith(href))
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
              title={label}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
