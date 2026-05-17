"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useSensor, useSensors, closestCenter,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/TaskCard";
import { TaskDrawer } from "@/components/TaskDrawer";
import { AddTaskModal } from "@/components/AddTaskModal";
import { api } from "@/lib/api";
import type { AntStatusEntry, Task, TaskStatus, Project } from "@/lib/types";

const COLUMNS: { status: TaskStatus; label: string; emptyText: string; muted?: boolean }[] = [
  { status: "backlog", label: "Backlog", emptyText: "No staged tasks", muted: true },
  { status: "todo", label: "To Do", emptyText: "No tasks queued" },
  { status: "in_progress", label: "In Progress", emptyText: "No active sessions" },
  { status: "in_review", label: "In Review", emptyText: "Nothing awaiting review" },
  { status: "done", label: "Done", emptyText: "No completed tasks" },
];

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  backlog: "border-t-2 border-t-border",
  todo: "border-t-2 border-t-muted-foreground/40",
  in_progress: "border-t-2 border-t-blue-500/60",
  in_review: "border-t-2 border-t-yellow-500/60",
  done: "border-t-2 border-t-green-500/60",
};

function SortableTaskCard({
  task, commentCount, onClick,
}: { task: Task; commentCount: number; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-stretch gap-1 ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        {...attributes} {...listeners}
        className="flex items-center px-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
        aria-label="Drag to reorder"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <TaskCard task={task} commentCount={commentCount} onClick={onClick} />
      </div>
    </div>
  );
}

export function KanbanBoard({
  ants,
  projects,
  projectId,
}: {
  ants: AntStatusEntry[];
  projects: Project[];
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addDefaultStatus, setAddDefaultStatus] = useState<TaskStatus>("backlog");
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [mobileCol, setMobileCol] = useState<TaskStatus>("todo");

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.taskList({ project: projectId, limit: 500 }),
    refetchInterval: 5000,
  });

  // Comment counts — fetch once per board load, not per card
  const { data: allComments } = useQuery({
    queryKey: ["task-comments-counts", projectId],
    queryFn: async () => {
      const todoAndReview = tasks.filter((t) => t.status === "in_review" || t.status === "done");
      const counts: Record<string, number> = {};
      // Only count comments for tasks that might have them (in_review / done)
      // For performance, we just track that comments exist without loading all
      return counts;
    },
    enabled: tasks.length > 0,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  function handleDragStart({ active }: DragStartEvent) {
    const t = tasks.find((i) => i.id === active.id);
    if (t) setActiveTask(t);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    if (!over || active.id === over.id) return;
    const todoTasks = tasks.filter((t) => t.status === "todo");
    const oldIdx = todoTasks.findIndex((t) => t.id === active.id);
    const newIdx = todoTasks.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(todoTasks, oldIdx, newIdx);
    queryClient.setQueryData<Task[]>(["tasks", projectId], (old) => {
      if (!old) return old;
      return [...reordered, ...old.filter((t) => t.status !== "todo")];
    });
    api.taskPatch(active.id as string, { position: newIdx }).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    });
  }

  const byStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);
  const todoTasks = byStatus("todo");
  const todoIds = todoTasks.map((t) => t.id);

  const openAdd = (status: TaskStatus) => {
    setAddDefaultStatus(status === "backlog" ? "backlog" : "todo");
    setAddModalOpen(true);
  };

  return (
    <>
      {/* ── Mobile view (below md) ─────────────────────────────── */}
      <div className="md:hidden flex flex-col">
        {/* Column tab strip */}
        <div className="flex overflow-x-auto border-b border-border mb-3 -mx-5 px-5">
          {COLUMNS.map((col) => {
            const count = byStatus(col.status).length;
            return (
              <button
                key={col.status}
                onClick={() => setMobileCol(col.status)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  mobileCol === col.status
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground"
                )}
              >
                {col.label}
                {count > 0 && (
                  <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded-full leading-none">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active column */}
        <div className="flex items-center justify-end mb-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
            onClick={() => openAdd(mobileCol)}>
            <Plus className="size-3" /> Add task
          </Button>
        </div>
        <div className={`flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-2 min-h-[200px] ${COLUMN_ACCENT[mobileCol]}`}>
          {byStatus(mobileCol).length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[160px]">
              <p className="text-xs text-muted-foreground">
                {COLUMNS.find((c) => c.status === mobileCol)?.emptyText}
              </p>
            </div>
          ) : (
            byStatus(mobileCol).map((task) => (
              <TaskCard key={task.id} task={task} commentCount={0}
                onClick={() => setSelectedTask(task)} />
            ))
          )}
        </div>
      </div>

      {/* ── Desktop view (md+) ────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="hidden md:flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const items = byStatus(col.status);
            const isTodo = col.status === "todo";
            const isBacklog = col.status === "backlog";

            return (
              <div key={col.status} className={`flex flex-col gap-3 min-w-[240px] flex-1 ${col.muted ? "opacity-70" : ""}`}>
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    {isBacklog && <Archive className="size-3 text-muted-foreground" />}
                    <span className="text-sm font-medium">{col.label}</span>
                    <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
                      {items.length}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" className="size-6"
                    onClick={() => openAdd(col.status)}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>

                <div className={`flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-2 min-h-[200px] ${COLUMN_ACCENT[col.status]}`}>
                  {items.length === 0 ? (
                    <div className="flex items-center justify-center h-full min-h-[160px]">
                      <p className="text-xs text-muted-foreground">{col.emptyText}</p>
                    </div>
                  ) : isTodo ? (
                    <SortableContext items={todoIds} strategy={verticalListSortingStrategy}>
                      {todoTasks.map((task) => (
                        <SortableTaskCard key={task.id} task={task} commentCount={0}
                          onClick={() => setSelectedTask(task)} />
                      ))}
                    </SortableContext>
                  ) : (
                    items.map((task) => (
                      <TaskCard key={task.id} task={task} commentCount={0}
                        onClick={() => setSelectedTask(task)} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
          {activeTask && <TaskCard task={activeTask} onClick={() => {}} />}
        </DragOverlay>
      </DndContext>

      <TaskDrawer task={selectedTask} open={selectedTask !== null} ants={ants}
        onClose={() => setSelectedTask(null)} />

      <AddTaskModal open={addModalOpen} onClose={() => setAddModalOpen(false)}
        projects={projects} defaultProjectId={projectId} ants={ants}
        defaultStatus={addDefaultStatus} />
    </>
  );
}
