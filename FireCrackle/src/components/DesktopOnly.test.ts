import { expect, it } from "vitest";
import type { ReactElement } from "react";
import { DesktopOnly } from "./DesktopOnly";

it("says what needs the desktop app, and nothing when the feature is available", () => {
  const note = DesktopOnly({ what: "Video scanning", available: false }) as ReactElement<{ children: unknown; className: string }>;
  expect(note.props.children).toEqual(["Video scanning", " is available in the desktop app."]);
  expect(note.props.className).toBe("dim desktop-only");
  expect(DesktopOnly({ what: "Video scanning", available: true })).toBeNull();
});
