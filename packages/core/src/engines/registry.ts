import type { EngineRunner } from "./types.js";

const ENGINE_REGISTRY: Record<string, EngineRunner> = {};

export function registerEngine(name: string, runner: EngineRunner): void {
  ENGINE_REGISTRY[name] = runner;
}

export function getEngine(name: string): EngineRunner {
  const engine = ENGINE_REGISTRY[name];
  if (!engine) {
    const available = Object.keys(ENGINE_REGISTRY).join(", ");
    throw new Error(
      `Unknown engine: "${name}". Available engines: ${available || "(none registered)"}`
    );
  }
  return engine;
}
