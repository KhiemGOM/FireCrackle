import { expect, it } from "vitest";
import css from "./JumpBox.css?raw";

it("the error message is placed above the box, where the video pane does not clip it", () => {
  const rule = /\.jump-error\s*\{([^}]*)\}/.exec(css)![1];
  expect(rule).toMatch(/bottom:/);
  expect(rule).not.toMatch(/top:/);
});
