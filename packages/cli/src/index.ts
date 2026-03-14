#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { version } from "../../../package.json";
import { runCommand } from "./commands/run";
import { validateCommand } from "./commands/validate";
import { initCommand } from "./commands/init";
import { versionCommand } from "./commands/version";
import { updateCommand } from "./commands/update";

const program = new Command()
  .name("colony")
  .description("Deploy and manage autonomous ant colonies")
  .version(version);

program.addCommand(initCommand);
program.addCommand(runCommand);
program.addCommand(validateCommand);
program.addCommand(versionCommand);
program.addCommand(updateCommand);

await program.parseAsync();
