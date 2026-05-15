"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { RawAntConfig, AntEngine } from "@/lib/types";
import { Save, AlertCircle, CheckCircle2, Info, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Flat form state — mirrors RawAntConfig but flattened for easier binding.
interface FormState {
  description: string;
  instructions: string;
  engine: AntEngine;
  cliBinary: string;
  cliArgs: string;
  pollInterval: string;
  discordChannel: string;
  githubRepos: string;     // newline-separated
  skills: string;          // newline-separated
  githubTrigger: boolean;
  githubLabels: string;    // comma-separated
  discordCommandTrigger: boolean;
  cronSchedule: string;
  stateBackend: "memory" | "sqlite";
  statePath: string;
}

function toFormState(c: RawAntConfig): FormState {
  const githubTrigger = c.triggers?.some((t) => t.type === "github_issue") ?? false;
  const githubLabels =
    (
      c.triggers?.find(
        (t): t is { type: "github_issue"; labels?: string[] } => t.type === "github_issue"
      )?.labels ?? []
    ).join(", ");

  return {
    description: c.description ?? "",
    instructions: c.instructions ?? "",
    engine: c.engine ?? "claude-cli",
    cliBinary: c.cli?.binary ?? "",
    cliArgs: (c.cli?.args ?? []).join("\n"),
    pollInterval: c.poll_interval ?? "",
    discordChannel: c.integrations?.discord?.channel ?? "",
    githubRepos: (c.integrations?.github?.repos ?? []).join("\n"),
    skills: (c.skills ?? []).join("\n"),
    githubTrigger,
    githubLabels,
    discordCommandTrigger: c.triggers?.some((t) => t.type === "discord_command") ?? false,
    cronSchedule: c.schedule?.cron ?? "",
    stateBackend: c.state?.backend ?? "memory",
    statePath: c.state?.path ?? "",
  };
}

function toRawConfig(name: string, f: FormState): RawAntConfig {
  const triggers: RawAntConfig["triggers"] = [];
  if (f.githubTrigger) {
    triggers.push({
      type: "github_issue",
      labels: f.githubLabels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  if (f.discordCommandTrigger) {
    triggers.push({ type: "discord_command" });
  }

  const repos = f.githubRepos
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const skills = f.skills
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const config: RawAntConfig = {
    name,
    description: f.description,
    instructions: f.instructions,
    engine: f.engine,
  };

  if (f.engine === "cli" && f.cliBinary) {
    config.cli = {
      binary: f.cliBinary,
      args: f.cliArgs
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  if (f.pollInterval.trim()) config.poll_interval = f.pollInterval.trim();
  if (f.cronSchedule.trim()) config.schedule = { cron: f.cronSchedule.trim() };
  if (triggers.length > 0) config.triggers = triggers;
  if (skills.length > 0) config.skills = skills;

  if (f.discordChannel.trim() || repos.length > 0) {
    config.integrations = {};
    if (f.discordChannel.trim()) {
      config.integrations.discord = { channel: f.discordChannel.trim() };
    }
    if (repos.length > 0) {
      config.integrations.github = { repos };
    }
  }

  if (f.stateBackend === "sqlite") {
    config.state = { backend: "sqlite", path: f.statePath.trim() || "./colony-state.db" };
  }

  return config;
}

const ENGINES: AntEngine[] = ["claude-cli", "gemini-cli", "codex", "opencode", "cli"];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-muted-foreground -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

export function AntConfigEditor({ antName }: { antName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: config, isLoading, error: fetchError } = useQuery({
    queryKey: ["config", "ant", antName],
    queryFn: () => api.configAntGet(antName),
    retry: false,
    refetchInterval: false,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Initialise form when config loads.
  useEffect(() => {
    if (config && !dirty) setForm(toFormState(config));
  }, [config, dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setSaveError(null);
  };

  const saveMutation = useMutation({
    mutationFn: () => api.configAntUpdate(antName, toRawConfig(antName, form!)),
    onSuccess: ({ restartRequired: needsRestart }) => {
      setDirty(false);
      setSaveError(null);
      if (needsRestart) setRestartRequired(true);
      queryClient.invalidateQueries({ queryKey: ["config", "ant", antName] });
    },
    onError: (err: Error) => {
      setSaveError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.configAntDelete(antName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      router.push("/ants");
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6">Loading config…</p>;
  }

  if (fetchError) {
    const msg = (fetchError as Error).message;
    const is503 = msg.startsWith("503");
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-4 text-sm">
        <Info className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          {is503 ? (
            <>
              <p className="font-medium">Config directory not available</p>
              <p className="text-muted-foreground mt-0.5">
                Make sure <code className="font-mono text-xs">monitoring.port</code> is set in{" "}
                <code className="font-mono text-xs">colony.yaml</code> and the runner is active.
              </p>
            </>
          ) : (
            <p>{msg}</p>
          )}
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Restart required banner */}
      {restartRequired && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <RotateCcw className="size-4 text-warning shrink-0" />
          <p className="text-sm text-warning flex-1">
            Config saved — restart the colony runner to apply changes.
          </p>
          <button
            onClick={() => setRestartRequired(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Identity (read-only) */}
      <Section title="Identity">
        <Field label="Name" hint="Changing the ant name requires deleting and recreating it.">
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono bg-secondary px-3 py-1.5 rounded-md border border-border text-muted-foreground">
              {antName}
            </code>
            <Badge variant="secondary" className="font-mono text-xs">read-only</Badge>
          </div>
        </Field>
        <Field label="Description">
          <Input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What this ant does"
          />
        </Field>
      </Section>

      <Separator />

      {/* Instructions */}
      <Section title="Instructions">
        <Field
          label="System prompt"
          hint="Injected at the start of every session. Supports Markdown."
        >
          <Textarea
            value={form.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder="You are an autonomous coding agent…"
          />
        </Field>
      </Section>

      <Separator />

      {/* Engine */}
      <Section title="Engine">
        <Field label="Agent engine">
          <select
            value={form.engine}
            onChange={(e) => set("engine", e.target.value as AntEngine)}
            className="h-9 rounded-md border border-input bg-input px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ENGINES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>

        {form.engine === "cli" && (
          <>
            <Field label="Binary" hint="Path or name of the CLI binary.">
              <Input
                value={form.cliBinary}
                onChange={(e) => set("cliBinary", e.target.value)}
                placeholder="/usr/local/bin/my-agent"
                className="font-mono text-sm"
              />
            </Field>
            <Field label="Extra args" hint="One argument per line, prepended before the prompt.">
              <Textarea
                value={form.cliArgs}
                onChange={(e) => set("cliArgs", e.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder="--model&#10;gpt-4o"
              />
            </Field>
          </>
        )}
      </Section>

      <Separator />

      {/* Scheduling */}
      <Section title="Scheduling">
        <Field
          label="Poll interval"
          hint="How long to sleep between autonomous runs (e.g. 5m, 1h). Leave blank to run continuously."
        >
          <Input
            value={form.pollInterval}
            onChange={(e) => set("pollInterval", e.target.value)}
            placeholder="5m"
            className="w-32"
          />
        </Field>
        <Field
          label="Cron schedule"
          hint="Standard cron expression (e.g. 0 9 * * 1-5). Leave blank to disable."
        >
          <Input
            value={form.cronSchedule}
            onChange={(e) => set("cronSchedule", e.target.value)}
            placeholder="0 9 * * 1-5"
            className="font-mono text-sm w-56"
          />
        </Field>
      </Section>

      <Separator />

      {/* Triggers */}
      <Section title="Triggers">
        <p className="text-xs text-muted-foreground -mt-2">
          All ants always accept human messages. Triggers control autonomous activation.
        </p>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={form.githubTrigger}
            onChange={(e) => set("githubTrigger", e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium group-hover:text-foreground">GitHub Issues</p>
            <p className="text-xs text-muted-foreground">
              Wake when a matching issue is opened or labelled.
            </p>
          </div>
        </label>

        {form.githubTrigger && (
          <Field
            label="Issue labels (comma-separated)"
            hint="Blank = all issues. e.g. bug, help wanted"
          >
            <Input
              value={form.githubLabels}
              onChange={(e) => set("githubLabels", e.target.value)}
              placeholder="bug, help wanted"
              className="ml-6 w-72"
            />
          </Field>
        )}

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={form.discordCommandTrigger}
            onChange={(e) => set("discordCommandTrigger", e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium group-hover:text-foreground">Discord command only</p>
            <p className="text-xs text-muted-foreground">
              Run only when a human sends a message; no autonomous scheduling.
            </p>
          </div>
        </label>
      </Section>

      <Separator />

      {/* Integrations */}
      <Section title="Integrations">
        <Field label="Discord channel" hint="Channel name or ID for this ant's output and commands.">
          <Input
            value={form.discordChannel}
            onChange={(e) => set("discordChannel", e.target.value)}
            placeholder="colony-worker"
            className="w-64"
          />
        </Field>
        <Field label="GitHub repos" hint="One owner/repo per line. e.g. acme/backend">
          <Textarea
            value={form.githubRepos}
            onChange={(e) => set("githubRepos", e.target.value)}
            rows={3}
            className="font-mono text-xs w-72"
            placeholder={"acme/backend\nacme/frontend"}
          />
        </Field>
      </Section>

      <Separator />

      {/* Skills */}
      <Section title="Skills">
        <Field
          label="Skill file paths"
          hint="One path per line, relative to the colony directory. e.g. config/examples/skills/code-review-standards.md"
        >
          <Textarea
            value={form.skills}
            onChange={(e) => set("skills", e.target.value)}
            rows={3}
            className="font-mono text-xs"
            placeholder={"skills/code-review.md\nskills/testing.md"}
          />
        </Field>
      </Section>

      <Separator />

      {/* State */}
      <Section title="State persistence">
        <Field label="Backend">
          <select
            value={form.stateBackend}
            onChange={(e) => set("stateBackend", e.target.value as "memory" | "sqlite")}
            className="h-9 w-36 rounded-md border border-input bg-input px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="memory">memory</option>
            <option value="sqlite">sqlite</option>
          </select>
        </Field>
        {form.stateBackend === "sqlite" && (
          <Field label="Database path" hint="Relative to the colony directory.">
            <Input
              value={form.statePath}
              onChange={(e) => set("statePath", e.target.value)}
              placeholder="./colony-state.db"
              className="font-mono text-sm w-72"
            />
          </Field>
        )}
      </Section>

      {/* Save bar */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-4 transition-colors",
          saveError
            ? "border-danger/30 bg-danger/5"
            : "border-border bg-secondary/20"
        )}
      >
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty}
        >
          <Save className="size-3.5" />
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </Button>

        {!dirty && !saveError && (
          <p className="text-xs text-muted-foreground">No unsaved changes.</p>
        )}
        {dirty && !saveError && (
          <p className="text-xs text-warning">Unsaved changes</p>
        )}
        {!dirty && !saveError && saveMutation.isSuccess && (
          <span className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="size-3.5" />
            Saved.
          </span>
        )}
        {saveError && (
          <span className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="size-3.5" />
            {saveError}
          </span>
        )}
      </div>

      {/* Danger zone */}
      <Separator />
      <Section title="Danger zone">
        {!confirmDelete ? (
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Delete this ant</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Removes the YAML file permanently. The runner must be restarted.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-danger border-danger/30 hover:bg-danger/10 shrink-0"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              Delete ant
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-danger/40 bg-danger/5 p-4">
            <p className="text-sm text-danger">
              Delete <strong>{antName}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Yes, delete"}
              </Button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
