"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkItemCard } from "@/components/WorkItemCard";
import { WorkItemDrawer } from "@/components/WorkItemDrawer";
import { AddWorkModal } from "@/components/AddWorkModal";
import { api } from "@/lib/api";
import type { AntStatusEntry, PersistedWorkItem, WorkItemStatus } from "@/lib/types";

const COLUMNS: { status: WorkItemStatus; label: string; emptyText: string }[] = [
  { status: "queued", label: "Queued", emptyText: "No items waiting" },
  { status: "running", label: "In Progress", emptyText: "No active sessions" },
  { status: "done", label: "Done", emptyText: "No completed work yet" },
  { status: "failed", label: "Failed", emptyText: "No failures" },
];

const COLUMN_ACCENTS: Record<WorkItemStatus, string> = {
  queued: "border-t-2 border-t-muted",
  running: "border-t-2 border-t-info",
  done: "border-t-2 border-t-success",
  failed: "border-t-2 border-t-danger",
  cancelled: "",
};

function KanbanColumn({
  status,
  label,
  emptyText,
  items,
  ants,
  onCardClick,
  onAdd,
}: {
  status: WorkItemStatus;
  label: string;
  emptyText: string;
  items: PersistedWorkItem[];
  ants: AntStatusEntry[];
  onCardClick: (item: PersistedWorkItem) => void;
  onAdd: () => void;
}) {
  return (
    <div className={`flex flex-col gap-3 min-w-[260px] flex-1`}>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
            {items.length}
          </span>
        </div>
        {status === "queued" && (
          <Button variant="ghost" size="icon" className="size-6" onClick={onAdd}>
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>

      <div
        className={`flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-2 min-h-[200px] ${COLUMN_ACCENTS[status]}`}
      >
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[160px]">
            <p className="text-xs text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          items.map((item) => (
            <WorkItemCard key={item.id} item={item} onClick={() => onCardClick(item)} />
          ))
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({ ants }: { ants: AntStatusEntry[] }) {
  const [selectedItem, setSelectedItem] = useState<PersistedWorkItem | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addDefaultAnt, setAddDefaultAnt] = useState<string | undefined>();

  const { data: workItems = [] } = useQuery({
    queryKey: ["work"],
    queryFn: () => api.workList({ limit: 200 }),
  });

  const byStatus = (status: WorkItemStatus) =>
    workItems.filter((i) => i.status === status);

  const openAddModal = (antName?: string) => {
    setAddDefaultAnt(antName);
    setAddModalOpen(true);
  };

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.status}
            {...col}
            items={byStatus(col.status)}
            ants={ants}
            onCardClick={setSelectedItem}
            onAdd={() => openAddModal()}
          />
        ))}
      </div>

      <WorkItemDrawer
        item={selectedItem}
        open={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
      />

      <AddWorkModal
        ants={ants}
        defaultAnt={addDefaultAnt}
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
      />
    </>
  );
}
