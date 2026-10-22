import { expect, it } from "vitest";
import { failureMessage } from "./appErrors";
import { messageOf } from "../hooks/useWorkspace";

it("there is one error-message helper: messageOf is failureMessage", () => {
  expect(messageOf).toBe(failureMessage);
});

it("never returns undefined or an 'Error:' prefix", () => {
  expect(failureMessage(undefined)).toBe("undefined");
  expect(failureMessage(new Error("disk full"))).toBe("disk full");
  expect(failureMessage(new TypeError(""))).toBe("TypeError");
  expect(failureMessage("plain")).toBe("plain");
  expect(failureMessage({ code: 3 })).toBe('{"code":3}');
});
