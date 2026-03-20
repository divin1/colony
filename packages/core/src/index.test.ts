import { describe, it, expect } from "bun:test";
import * as core from "./index";

describe("@colony/core exports", () => {
  it("exports config schemas", () => {
    expect(core.ColonyConfigSchema).toBeDefined();
    expect(core.AntConfigSchema).toBeDefined();
  });

  it("exports runner utilities", () => {
    expect(core.buildCommonInstructions).toBeDefined();
  });

  it("exports hooks", () => {
    expect(core.isDangerousRaw).toBeDefined();
    expect(core.createConfirmationHook).toBeDefined();
  });

  it("exports ant runner", () => {
    expect(core.runAnt).toBeDefined();
  });
});
