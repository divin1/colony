#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { runCommand } from "./commands/run";
import { validateCommand } from "./commands/validate";
import { initCommand } from "./commands/init";

const program = new Command()
  .name("colony")
  .description("Deploy and manage autonomous ant colonies")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(runCommand);
program.addCommand(validateCommand);

await program.parseAsync();
