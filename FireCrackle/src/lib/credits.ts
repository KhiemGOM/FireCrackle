/** Who FireCrackle owes its method to. Plain data, so it can be checked. */

export interface CreditEntry {
  name: string;
  note: string;
}

export interface CreditSection {
  title: string;
  entries: CreditEntry[];
}

export const CREDITS: CreditSection[] = [
  {
    title: "The research behind Fire Cracking",
    entries: [
      { name: "Dijakonal", note: "started investigating fire in more depth and brought up that it is tick-based." },
      { name: "Lagios", note: "discovered how to use fire animations to detect splices." },
      { name: "Jasper", note: "had the idea to combine that with jolt cracking." },
      { name: "Dart", note: "gave hints throughout the process." },
    ],
  },
  {
    title: "Community",
    entries: [
      {
        name: "Minecraft Forensics",
        note: "and everyone in it not named above: thank you for the ideas, your own research, beta testing, and feedback on the tools.",
      },
    ],
  },
  {
    title: "Tool development",
    entries: [{ name: "KhiemGOM", note: "built FireCrackle." }],
  },
  {
    title: "External tools · downloaded separately",
    entries: [
      { name: "Splosh", note: "made JoltCracker, which FireCrackle runs on your videos with his permission · splosh.icu/jolt · source: gitlab.com/skippyznjiff/jolt (MIT)." },
      { name: "yt-dlp contributors", note: "provide online video downloads · github.com/yt-dlp/yt-dlp · source: Unlicense; standalone builds contain separately licensed components." },
      { name: "Deno contributors", note: "provide the JavaScript runtime for YouTube extraction · deno.com · MIT and third-party licenses." },
      { name: "FFmpeg contributors and Gyan Doshi", note: "provide video decoding, probing and compression · ffmpeg.org / gyan.dev · Windows full build (with dav1d): GPLv3." },
    ],
  },
];

export function creditNames(sections: CreditSection[] = CREDITS): string[] {
  return sections.flatMap((s) => s.entries.map((e) => e.name));
}

/** Everything wrong with the credits data; empty when it is fine. */
export function validateCredits(sections: CreditSection[]): string[] {
  const problems: string[] = [];
  if (sections.length === 0) problems.push("no sections");
  const seen = new Set<string>();
  for (const s of sections) {
    if (s.title.trim() === "") problems.push("a section has no title");
    if (s.entries.length === 0) problems.push(`section "${s.title}" is empty`);
    for (const e of s.entries) {
      if (e.name.trim() === "") problems.push(`an entry in "${s.title}" has no name`);
      else if (e.name !== e.name.trim()) problems.push(`"${e.name}" has stray whitespace`);
      if (e.note.trim() === "") problems.push(`"${e.name}" has no note`);
      const key = e.name.trim().toLowerCase();
      if (key !== "" && seen.has(key)) problems.push(`"${e.name}" is credited twice`);
      seen.add(key);
    }
  }
  return problems;
}
