import {expect, it} from "vitest";
import {parseDisguise} from "./party-mode";

it("accepts a server-approved disguise and its available choices", () => {
    expect(parseDisguise("[12:00:00] WINLIFE_PROP 1 4 31")).toEqual({choice: 4, available: 31});
    expect(parseDisguise("WINLIFE_PROP 1 0 7")).toEqual({choice: 0, available: 7});
});

it("ignores unsupported or unavailable disguises", () => {
    for (const notice of ["WINLIFE_PROP 2 1 31", "WINLIFE_PROP 1 2 1", "WINLIFE_PROP 1 6 31",
        "WINLIFE_PROP 1 1 32", "chat: WINLIFE_PROP 1 4 31"]) {
        expect(parseDisguise(notice)).toBeUndefined();
    }
});
