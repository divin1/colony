"use client";

import { createContext, useContext } from "react";
import type { ConnectionStatus } from "./useColonyEvents";

export const ConnectionContext = createContext<ConnectionStatus>("disconnected");

export function useConnectionStatus(): ConnectionStatus {
  return useContext(ConnectionContext);
}
