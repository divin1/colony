"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStoredKey } from "./auth";

type ColonyEvent =
  | { type: "task"; action: "created" | "updated" | "deleted"; taskId: string }
  | { type: "project"; action: "created" | "updated" | "deleted"; projectId: string }
  | { type: "ant-state"; name: string; state: string };

export type ConnectionStatus = "connected" | "stale" | "disconnected";

export function useColonyEvents(): ConnectionStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  // Track last message time to detect stale connections (connected but silent > 60s)
  const lastMessageRef = useRef<number>(Date.now());

  useEffect(() => {
    const key = getStoredKey();
    const qs = key ? `?key=${encodeURIComponent(key)}` : "";
    const es = new EventSource(`/api/events${qs}`);

    es.onopen = () => {
      setStatus("connected");
      lastMessageRef.current = Date.now();
    };

    es.onmessage = (e: MessageEvent<string>) => {
      lastMessageRef.current = Date.now();
      setStatus("connected");

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

    es.onerror = () => setStatus("disconnected");

    // Check every 10s whether the last message was > 60s ago (stale heartbeat)
    const staleness = setInterval(() => {
      if (es.readyState === EventSource.OPEN) {
        const age = Date.now() - lastMessageRef.current;
        setStatus(age > 60_000 ? "stale" : "connected");
      }
    }, 10_000);

    return () => {
      es.close();
      clearInterval(staleness);
    };
  }, [queryClient]);

  return status;
}
