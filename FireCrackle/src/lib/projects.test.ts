import { describe, expect, it } from "vitest";
import {
  MAX_PROJECTS, PROJECTS_STORAGE_KEY, projectKey, projectName, readProjects, recordProject, removeProject,
  savedFrame, seedFromSession, writeProjects, type ProjectEntry,
} from "./projects";

const fresh = (videoPath: string, frame = 0) => ({ videoPath, frame, frameCount: 1000, labelled: 10 });

describe("project identity", () => {
  it("names a project after its video file without folder or extension", () => {
    expect(projectName("D:\\clips\\nether run.mkv")).toBe("nether run");
    expect(projectName("/home/me/a.b.mp4")).toBe("a.b");
    expect(projectName("clip")).toBe("clip");
  });

  it("treats the same video spelled differently as one project", () => {
    expect(projectKey("D:\\clips\\a.mkv")).toBe(projectKey("D:/clips/a.mkv"));
    expect(projectKey("d:\\Clips\\A.mkv")).toBe(projectKey("D:\\clips\\a.mkv"));
    expect(projectKey("D:\\clips\\a.mkv ")).toBe(projectKey("D:\\clips\\a.mkv"));
  });

  it("keeps different videos apart", () => {
    expect(projectKey("D:\\clips\\a.mkv")).not.toBe(projectKey("D:\\clips\\b.mkv"));
    expect(projectKey("D:\\one\\a.mkv")).not.toBe(projectKey("D:\\two\\a.mkv"));
  });

  it("is case sensitive for non-Windows paths", () => {
    expect(projectKey("/home/me/A.mkv")).not.toBe(projectKey("/home/me/a.mkv"));
  });
});

describe("recording projects", () => {
  it("importing a new video creates a new project at the top", () => {
    let list = recordProject([], fresh("a.mkv"), 1);
    list = recordProject(list, fresh("b.mkv"), 2);
    expect(list.map(p => p.videoPath)).toEqual(["b.mkv", "a.mkv"]);
    expect(list[0]).toMatchObject({ name: "b", createdAt: 2, openedAt: 2, frame: 0, frameCount: 1000, labelled: 10 });
  });

  it("reopening a video updates its project instead of adding another", () => {
    let list = recordProject([], fresh("D:\\c\\a.mkv", 5), 1);
    list = recordProject(list, fresh("D:\\c\\b.mkv"), 2);
    list = recordProject(list, { videoPath: "D:/c/a.mkv", frame: 77, frameCount: 1000, labelled: 40 }, 3);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ frame: 77, labelled: 40, createdAt: 1, openedAt: 3 });
    expect(list[1].videoPath).toBe("D:\\c\\b.mkv");
  });

  it("never mutates the list it was given", () => {
    const before = recordProject([], fresh("a.mkv"), 1);
    const snapshot = JSON.stringify(before);
    recordProject(before, fresh("b.mkv"), 2);
    recordProject(before, fresh("a.mkv", 9), 2);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses an empty path and sanitises bad numbers", () => {
    expect(() => recordProject([], fresh("   "), 1)).toThrow();
    const [p] = recordProject([], { videoPath: "a.mkv", frame: -3, frameCount: NaN, labelled: 1.5 }, 1);
    expect(p).toMatchObject({ frame: 0, frameCount: 0, labelled: 0 });
  });

  it("forgets the oldest projects past the limit", () => {
    let list: ProjectEntry[] = [];
    for (let i = 0; i < MAX_PROJECTS + 5; i++) list = recordProject(list, fresh(`v${i}.mkv`), i);
    expect(list).toHaveLength(MAX_PROJECTS);
    expect(list[0].videoPath).toBe(`v${MAX_PROJECTS + 4}.mkv`);
    expect(list.some(p => p.videoPath === "v0.mkv")).toBe(false);
  });
});

describe("removing projects", () => {
  it("removes only the matching project, whatever the path spelling", () => {
    let list = recordProject([], fresh("D:\\c\\a.mkv"), 1);
    list = recordProject(list, fresh("D:\\c\\b.mkv"), 2);
    expect(removeProject(list, "d:/c/A.mkv").map(p => p.name)).toEqual(["b"]);
    expect(removeProject(list, "D:\\c\\none.mkv")).toHaveLength(2);
  });

  it("a removed video becomes a new project when it is imported again", () => {
    let list = recordProject([], fresh("a.mkv", 30), 1);
    list = removeProject(list, "a.mkv");
    list = recordProject(list, fresh("a.mkv"), 9);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ createdAt: 9, frame: 0 });
  });
});

describe("storage", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  };

  it("round-trips the list", () => {
    const s = memory();
    const list = recordProject(recordProject([], fresh("a.mkv"), 1), fresh("D:\\火 2026.mkv", 4), 2);
    writeProjects(s, list);
    expect(s.values.has(PROJECTS_STORAGE_KEY)).toBe(true);
    expect(readProjects(s)).toEqual(list);
  });

  it("reads nothing from absent, corrupt or foreign data", () => {
    for (const raw of [null, "", "{", "null", "{}", '"x"', "42"]) expect(readProjects({ getItem: () => raw })).toEqual([]);
  });

  it("drops invalid and duplicate entries but keeps the good ones", () => {
    const good = recordProject([], fresh("D:\\c\\a.mkv"), 1)[0];
    const raw = JSON.stringify([good, null, 7, { videoPath: "" }, { ...good, videoPath: "d:/C/A.mkv", frame: 9 }, { videoPath: "b.mkv" }]);
    const list = readProjects({ getItem: () => raw });
    expect(list.map(p => p.videoPath)).toEqual(["D:\\c\\a.mkv", "b.mkv"]);
    expect(list[1]).toMatchObject({ name: "b", frame: 0, frameCount: 0, labelled: 0 });
  });

  it("sorts most recently opened first on read", () => {
    const a = recordProject([], fresh("a.mkv"), 5)[0];
    const b = recordProject([], fresh("b.mkv"), 9)[0];
    expect(readProjects({ getItem: () => JSON.stringify([a, b]) }).map(p => p.name)).toEqual(["b", "a"]);
  });

  it("reports storage failures instead of hiding them", () => {
    expect(() => writeProjects({ setItem: () => { throw new Error("storage full"); } }, [])).toThrow("storage full");
    expect(() => readProjects({ getItem: () => { throw new Error("blocked"); } })).toThrow("blocked");
  });
});

describe("carrying over the old single saved session", () => {
  it("makes the last video the first project", () => {
    const list = seedFromSession([], { videoPath: "a.mkv", frame: 12 }, 4);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ videoPath: "a.mkv", frame: 12, openedAt: 4 });
  });

  it("changes nothing when there is no old session or the list already exists", () => {
    expect(seedFromSession([], null, 1)).toEqual([]);
    const existing = recordProject([], fresh("b.mkv"), 1);
    expect(seedFromSession(existing, { videoPath: "a.mkv", frame: 1 }, 2)).toBe(existing);
  });
});

describe("resuming a project", () => {
  it("finds the saved frame however the video path is spelled", () => {
    const list = recordProject([], fresh("D:\\clips\\a.mkv", 4500), 1);
    expect(savedFrame(list, "d:/clips/a.mkv")).toBe(4500);
    expect(savedFrame(list, "D:\\clips\\b.mkv")).toBe(0);
  });
});
