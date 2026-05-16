"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkItemCard } from "@/components/WorkItemCard";
import { WorkItemDrawer } from "@/components/WorkItemDrawer";
import { AddWorkModal } from "@/components/AddWorkModal";
import { api } from "@/lib/api";
import type { AntStatusEntry, PersistedWorkItem, WorkItemStatus } from "@/lib/types";

// Drag handle + card for the Queued column.
function SortableWorkItemCard({
  item,
  onClick,
}: {
  item: PersistedWorkItem;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-stretch gap-1 ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="flex items-center px-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
        aria-label="Drag to reorder"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <WorkItemCard item={item} onClick={onClick} />
      </div>
    </div>
  );
}

const COLUMN_ACCENTS: Record<WorkItemStatus, string> = {
  queued: "border-t-2 border-t-muted",
  running: "border-t-2 border-t-blue-500/60",
  done: "border-t-2 border-t-green-500/60",
  failed: "border-t-2 border-t-red-500/60",
  cancelled: "",
};

const COLUMNS: { status: WorkItemStatus; label: string; emptyText: string }[] = [
  { status: "queued", label: "Queued", emptyText: "No items waiting" },
  { status: "running", label: "In Progress", emptyText: "No active sessions" },
  { status: "done", label: "Done", emptyText: "No completed work yet" },
  { status: "failed", label: "Failed", emptyText: "No failures" },
];

export function KanbanBoard({ ants }: { ants: AntStatusEntry[] }) {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<PersistedWorkItem | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addDefaultAnt, setAddDefaultAnt] = useState<string | undefined>();
  const [activeItem, setActiveItem] = useState<PersistedWorkItem | null>(null);

  const { data: workItems = [] } = useQuery({
    queryKey: ["work"],
    queryFn: () => api.workList({ limit: 200 }),
    refetchInterval: 5000,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  function handleDragStart({ active }: DragStartEvent) {
    const item = workItems.find((i) => i.id === active.id);
    if (item) setActiveItem(item);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveItem(null);
    if (!over || active.id === over.id) return;

    const queuedItems = workItems.filter((i) => i.status === "queued");
    const oldIndex = queuedItems.findIndex((i) => i.id === active.id);
    const newIndex = queuedItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic update — swap in the cache immediately.
    const reordered = arrayMove(queuedItems, oldIndex, newIndex);
    queryClient.setQueryData<PersistedWorkItem[]>(["work"], (old) => {
      if (!old) return old;
      return [...reordered, ...old.filter((i) => i.status !== "queued")];
    });

    api.workReorder(active.id as string, newIndex).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["work"] });
    });
  }

  const byStatus = (status: WorkItemStatus) => workItems.filter((i) => i.status === status);
  const queuedItems = byStatus("queued");
  const queuedIds = queuedItems.map((i) => i.id);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const items = byStatus(col.status);
            const isQueued = col.status === "queued";

            return (
              <div key={col.status} className="flex flex-col gap-3 min-w-[260px] flex-1">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{col.label}</span>
                    <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
                      {items.length}
                    </span>
                  </div>
                  {isQueued && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => { setAddDefaultAnt(undefined); setAddModalOpen(true); }}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  )}
                </div>

                <div
                  className={`flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-2 min-h-[200px] ${COLUMN_ACCENTS[col.status]}`}
                >
                  {items.length === 0 ? (
                    <div className="flex items-center justify-center h-full min-h-[160px]">
                      <p className="text-xs text-muted-foreground">{col.emptyText}</p>
                    </div>
                  ) : isQueued ? (
                    <SortableContext items={queuedIds} strategy={verticalListSortingStrategy}>
                      {queuedItems.map((item) => (
                        <SortableWorkItemCard
                          key={item.id}
                          item={item}
                          onClick={() => setSelectedItem(item)}
                        />
                      ))}
                    </SortableContext>
                  ) : (
                    items.map((item) => (
                      <WorkItemCard
                        key={item.id}
                        item={item}
                        onClick={() => setSelectedItem(item)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
          {activeItem && <WorkItemCard item={activeItem} onClick={() => {}} />}
        </DragOverlay>
      </DndContext>

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
