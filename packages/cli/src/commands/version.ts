import { Command } from "@commander-js/extra-typings";
import { version } from "../../../../package.json";

export const versionCommand = new Command("version")
  .description("Print the installed colony version")
  .action(() => {
    console.log(`colony v${version}`);
  });
