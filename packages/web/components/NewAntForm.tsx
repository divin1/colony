"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { RawAntConfig, AntEngine } from "@/lib/types";
import { Plus, AlertCircle, CheckCircle2, RotateCcw, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  description: string;
  instructions: string;
  engine: AntEngine;
  cliBinary: string;
  cliArgs: string;
  pollInterval: string;
  discordChannel: string;
  skills: string;
  discordCommandTrigger: boolean;
  cronSchedule: string;
}

const BLANK: FormState = {
  name: "",
  description: "",
  instructions: "",
  engine: "claude-cli",
  cliBinary: "",
  cliArgs: "",
  pollInterval: "",
  discordChannel: "",
  skills: "",
  discordCommandTrigger: false,
  cronSchedule: "",
};

function toRawConfig(f: FormState): RawAntConfig {
  const triggers: RawAntConfig["triggers"] = [];
  if (f.discordCommandTrigger) triggers.push({ type: "discord_command" });

  const skills = f.skills.split("\n").map((s) => s.trim()).filter(Boolean);

  const config: RawAntConfig = {
    name: f.name.trim(),
    description: f.description.trim(),
    instructions: f.instructions.trim(),
    engine: f.engine,
  };

  if (f.engine === "cli" && f.cliBinary.trim()) {
    config.cli = {
      binary: f.cliBinary.trim(),
      args: f.cliArgs.split("\n").map((s) => s.trim()).filter(Boolean),
    };
  }
  if (f.pollInterval.trim()) config.poll_interval = f.pollInterval.trim();
  if (f.cronSchedule.trim()) config.schedule = { cron: f.cronSchedule.trim() };
  if (triggers.length > 0) config.triggers = triggers;
  if (skills.length > 0) config.skills = skills;
  if (f.discordChannel.trim()) {
    config.integrations = { discord: { channel: f.discordChannel.trim() } };
  }
  return config;
}

const ENGINES: AntEngine[] = ["claude-cli", "gemini-cli", "codex", "opencode", "cli"];

function Field({ label, hint, required, children }: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {hint && <p className="text-xs text-muted-foreground -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function NewAntForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(BLANK);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setCreateError(null);
  };

  const createMutation = useMutation({
    mutationFn: () => api.configAntCreate(toRawConfig(form)),
    onSuccess: () => {
      setCreatedName(form.name.trim());
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const isValid = form.name.trim() && form.description.trim() && form.instructions.trim();

  if (createdName) {
    return (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 p-5">
          <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-medium text-success">Ant created</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                <code className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">{createdName}</code>
                {" "}has been written to <code className="font-mono text-xs">ants/{createdName}.yaml</code>.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-warning">
              <RotateCcw className="size-3.5 shrink-0" />
              Restart the colony runner to load this ant.
            </div>
            <div className="flex gap-2">
              <Button size="sm" asChild>
                <Link href={`/ants/${encodeURIComponent(createdName)}`}>
                  View config
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setForm(BLANK);
                  setCreatedName(null);
                }}
              >
                Create another
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">

      {/* Identity */}
      <Section title="Identity">
        <Field label="Name" required hint="Lowercase letters, numbers, and hyphens. Used as the YAML filename.">
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="my-worker"
            className="w-64 font-mono"
            autoFocus
          />
        </Field>
        <Field label="Description" required hint="One sentence describing what this ant does.">
          <Input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Triages GitHub issues and drafts initial responses"
            className="w-full max-w-md"
          />
        </Field>
      </Section>

      <Separator />

      {/* Instructions */}
      <Section title="Instructions">
        <Field label="System prompt" required hint="Injected at the start of every session. Supports Markdown.">
          <Textarea
            value={form.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder={"You are an autonomous coding agent working on the acme/backend repo.\n\nAt the start of each session, read PLAN.md to resume where you left off.\n\nAlways commit changes with clear messages."}
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
              <option key={e} value={e}>{e}</option>
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
              />
            </Field>
          </>
        )}
      </Section>

      <Separator />

      {/* Scheduling */}
      <Section title="Scheduling">
        <Field label="Poll interval" hint="Sleep between continuous runs (e.g. 5m, 1h). Leave blank to run back-to-back.">
          <Input
            value={form.pollInterval}
            onChange={(e) => set("pollInterval", e.target.value)}
            placeholder="5m"
            className="w-32"
          />
        </Field>
        <Field label="Cron schedule" hint="e.g. 0 9 * * 1-5 to run weekdays at 9am. Leave blank to disable.">
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
          All ants always accept human messages regardless of trigger config.
        </p>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={form.discordCommandTrigger}
            onChange={(e) => set("discordCommandTrigger", e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium group-hover:text-foreground">Discord command only</p>
            <p className="text-xs text-muted-foreground">Run only when a human sends a message.</p>
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
      </Section>

      <Separator />

      {/* Skills */}
      <Section title="Skills">
        <Field label="Skill file paths" hint="One path per line, relative to the colony directory.">
          <Textarea
            value={form.skills}
            onChange={(e) => set("skills", e.target.value)}
            rows={3}
            className="font-mono text-xs"
            placeholder={"skills/code-review.md\nskills/testing.md"}
          />
        </Field>
      </Section>

      {/* Create bar */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-4 transition-colors",
          createError ? "border-danger/30 bg-danger/5" : "border-border bg-secondary/20"
        )}
      >
        <Button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !isValid}
        >
          <Plus className="size-3.5" />
          {createMutation.isPending ? "Creating…" : "Create ant"}
        </Button>

        {!isValid && (
          <p className="text-xs text-muted-foreground">Name, description, and instructions are required.</p>
        )}
        {createError && (
          <span className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="size-3.5" />
            {createError}
          </span>
        )}
      </div>
    </div>
  );
}
