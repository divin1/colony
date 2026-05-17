"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStoredKey } from "./auth";

type ColonyEvent =
  | { type: "task"; action: "created" | "updated" | "deleted"; taskId: string }
  | { type: "project"; action: "created" | "updated" | "deleted"; projectId: string }
  | { type: "ant-state"; name: string; state: string };

export function useColonyEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const key = getStoredKey();
    const qs = key ? `?key=${encodeURIComponent(key)}` : "";
    const es = new EventSource(`/api/events${qs}`);

    es.onmessage = (e: MessageEvent<string>) => {
      let event: ColonyEvent;
      try {
        event = JSON.parse(e.data) as ColonyEvent;
      } catch {
        return;
      }

      if (event.type === "task") {
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        if (event.taskId) {
          void queryClient.invalidateQueries({ queryKey: ["task", event.taskId] });
        }
      } else if (event.type === "project") {
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      } else if (event.type === "ant-state") {
        void queryClient.invalidateQueries({ queryKey: ["status"] });
      }
    };

    return () => es.close();
  }, [queryClient]);
}
