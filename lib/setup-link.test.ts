import { describe, expect, it } from "vitest";
import { installCommand, parseSetupLink } from "./setup-link";

const CODE = "0123456789abcdef0123456789abcdef";
const SCRIPT = "curl -fsSL https://github.com/iblai/ontology/releases/latest/download/install.sh";
const DEFAULTS = { frontend: "https://ontology.ibl.ai", platformUrl: "https://api.iblai.app/dm" };

describe("parseSetupLink", () => {
  it("reads a good link", () => {
    expect(parseSetupLink(`#host=Ontology.University.edu&code=${CODE}`)).toEqual({
      host: "ontology.university.edu",
      code: CODE,
    });
  });

  it("refuses a code that is not 32 hex", () => {
    expect(parseSetupLink("#host=ontology.university.edu&code=abc")).toBeNull();
    expect(parseSetupLink(`#host=ontology.university.edu&code=${CODE.toUpperCase()}`)).toBeNull();
    expect(parseSetupLink(`#host=ontology.university.edu&code=${CODE}0`)).toBeNull();
  });

  it("refuses a host that is not a host", () => {
    expect(parseSetupLink(`#host=intranet&code=${CODE}`)).toBeNull();
    expect(parseSetupLink(`#host=https://evil.example/x&code=${CODE}`)).toBeNull();
    expect(parseSetupLink(`#code=${CODE}`)).toBeNull();
  });

  it("takes the parameters in either order", () => {
    expect(parseSetupLink(`#code=${CODE}&host=ontology.university.edu`)).toEqual({
      host: "ontology.university.edu",
      code: CODE,
    });
  });

  it("reads nothing from an empty hash", () => {
    expect(parseSetupLink("")).toBeNull();
    expect(parseSetupLink("#")).toBeNull();
  });
});

describe("installCommand", () => {
  it("runs the script bare with no host", () => {
    expect(installCommand(DEFAULTS)).toBe(`${SCRIPT} \\\n  | sudo bash`);
    expect(installCommand({ ...DEFAULTS, host: "not a host" })).toBe(`${SCRIPT} \\\n  | sudo bash`);
  });

  it("names the host", () => {
    expect(installCommand({ ...DEFAULTS, host: " Ontology.University.edu " })).toBe(
      `${SCRIPT} \\\n  | sudo bash -s -- \\\n    --host ontology.university.edu`,
    );
  });

  it("names a frontend that is not the default", () => {
    expect(installCommand({ ...DEFAULTS, frontend: "https://ontology.iblai.me" })).toBe(
      `${SCRIPT} \\\n  | sudo bash -s -- \\\n    --frontend https://ontology.iblai.me`,
    );
  });

  it("names a platform address that is not the default", () => {
    const command = installCommand({
      ...DEFAULTS,
      host: "ontology.university.edu",
      platformUrl: "https://api.university.edu/dm",
    });
    expect(command).toBe(
      [
        SCRIPT,
        "  | sudo bash -s --",
        "    --host ontology.university.edu",
        "    --platform-url https://api.university.edu/dm",
      ].join(" \\\n"),
    );
  });
});
