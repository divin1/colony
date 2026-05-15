"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Bug, History, Settings } from "lucide-react";

const links = [
  { href: "/", label: "Board", icon: LayoutDashboard },
  { href: "/ants", label: "Ants", icon: Bug },
  { href: "/work", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({ colonyName }: { colonyName?: string }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-card sticky top-0 z-40">
      <div className="flex items-center gap-6 px-5 h-12">
        <div className="flex items-center gap-2 mr-4">
          <span className="text-base">🐜</span>
          <span className="font-semibold text-sm text-foreground">
            {colonyName ?? "Colony"}
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === href || (href !== "/" && pathname.startsWith(href))
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
