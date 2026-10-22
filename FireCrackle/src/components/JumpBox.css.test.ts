import { expect, it } from "vitest";

it("the error message is placed above the box, where the video pane does not clip it", async () => {
  // vitest hands stylesheets back empty, so read the file itself.
  const fs: any = await import(/* @vite-ignore */ "node:" + "fs");
  const css: string = fs.readFileSync(new URL("./JumpBox.css", import.meta.url), "utf8");
  const rule = /\.jump-error\s*\{([^}]*)\}/.exec(css)![1];
  expect(rule).toMatch(/bottom:/);
  expect(rule).not.toMatch(/top:/);
});
