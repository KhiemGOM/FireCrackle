import { expect, it } from "vitest";
import { candidateConfirmation, candidateDigit, currentCandidate, replacedLabel, candidateText } from "./labelCandidate";
import {labelsEqual} from './grid';
it('confirms source-specific absence without turning it into no fire',()=>{
 const label={no_texture:{atlas:'water_still' as const}};
 expect(candidateConfirmation({label,origin:'picked'})).toEqual({type:'setLabel',label});
 expect(candidateText(label)).toBe('No still water');
 expect(labelsEqual(label,{no_texture:{atlas:'water_still'}})).toBe(true);
 expect(labelsEqual(label,{no_texture:{atlas:'water_flow'}})).toBe(false);
 expect(labelsEqual(label,'no_fire')).toBe(false);
});
const view = { current: 10, label: "unset" as const, suggestion: { sheet: 1, row: 7, mirrored: false, alt_row: 8, from_frame: 1 } };
it("requires a separate confirmation action and never carries a draft into another frame", () => {
  const draft = { frame: 10, label: { fire: { sheet: 0, row: 31, mirrored: true } }, origin: "picked" as const };
  expect(candidateConfirmation(currentCandidate(view, draft))).toEqual({ type: "clickCell", col: 2, row: 31 });
  expect(candidateConfirmation(currentCandidate({ ...view, current: 11 }, draft))).toEqual({ type: "acceptSuggestion" });
  expect(currentCandidate({ ...view, suggestion: null }, null)).toBeNull();
});
it("uses the saved label before a guess, and keeps no-fire and skip reviewed labels", () => {
  expect(currentCandidate({ ...view, label: "no_fire" }, null)).toEqual({ label: "no_fire", origin: "saved" });
  expect(candidateConfirmation({ label: "no_fire", origin: "picked" })).toEqual({ type: "noFire" });
  expect(candidateConfirmation({ label: "skip", origin: "picked" })).toEqual({ type: "skip" });
});
it("typing only produces a draft, with invalid rows blocking confirmation", () => {
  const pick = { sheet: 0, mirrored: true };
  const first = candidateDigit(10, null, 3, pick);
  expect(first.label).toEqual({ fire: { ...pick, row: 3 } });
  const valid = candidateDigit(10, first, 1, pick);
  expect(candidateConfirmation(currentCandidate(view, valid))).toEqual({ type: "clickCell", col: 2, row: 31 });
  const invalid = candidateDigit(10, first, 5, pick);
  expect(candidateConfirmation(currentCandidate(view, invalid))).toBeNull();
});

const fire = (sheet: number, row: number, mirrored = false) => ({ fire: { sheet, row, mirrored } });
const labelled = (label: "no_fire" | "skip" | ReturnType<typeof fire>) => ({ ...view, label });
const picked = (label: ReturnType<typeof fire> | "no_fire" | "skip") => ({ frame: 10, label, origin: "picked" as const });

it("warns when Confirm would replace a different saved fire label", () => {
  const saved = fire(0, 12);
  expect(replacedLabel(labelled(saved), currentCandidate(labelled(saved), picked(fire(0, 13))))).toEqual(saved);
  expect(replacedLabel(labelled(saved), currentCandidate(labelled(saved), picked(fire(1, 12))))).toEqual(saved);
  expect(replacedLabel(labelled(saved), currentCandidate(labelled(saved), picked(fire(0, 12, true))))).toEqual(saved);
});

it("warns when the saved label is no fire or skip and the candidate differs, and the other way round", () => {
  const cases: Array<[Parameters<typeof labelled>[0], ReturnType<typeof fire> | "no_fire" | "skip"]> = [
    ["no_fire", fire(0, 1)], ["no_fire", "skip"], ["skip", fire(0, 1)], ["skip", "no_fire"],
    [fire(0, 1), "no_fire"], [fire(0, 1), "skip"],
  ];
  for (const [saved, next] of cases) {
    const v = labelled(saved);
    expect(replacedLabel(v, currentCandidate(v, picked(next)))).toEqual(saved);
  }
});

it("does not warn on an unlabelled frame, with or without a time guess", () => {
  expect(replacedLabel(view, currentCandidate(view, picked(fire(0, 13))))).toBeNull();
  expect(replacedLabel(view, currentCandidate(view, null))).toBeNull(); // the time guess
  expect(replacedLabel({ label: "unset" }, null)).toBeNull();
});

it("does not warn when the candidate is the saved label itself", () => {
  const saved = fire(1, 7, true);
  expect(replacedLabel(labelled(saved), currentCandidate(labelled(saved), null))).toBeNull(); // saved, no draft
  expect(replacedLabel(labelled(saved), currentCandidate(labelled(saved), picked(fire(1, 7, true))))).toBeNull();
  expect(replacedLabel(labelled("no_fire"), currentCandidate(labelled("no_fire"), picked("no_fire")))).toBeNull();
  expect(replacedLabel(labelled("skip"), currentCandidate(labelled("skip"), picked("skip")))).toBeNull();
});

it("does not warn when nothing can be confirmed", () => {
  const saved = fire(0, 12);
  const v = labelled(saved);
  const invalid = candidateDigit(10, candidateDigit(10, null, 3, { sheet: 0, mirrored: false }), 5, { sheet: 0, mirrored: false });
  expect(currentCandidate(v, invalid)).toBeNull();
  expect(replacedLabel(v, currentCandidate(v, invalid))).toBeNull();
  expect(replacedLabel(v, null)).toBeNull();
});

it("ignores a draft made on another frame", () => {
  const saved = fire(0, 12);
  const v = labelled(saved);
  const draftElsewhere = { frame: 99, label: fire(0, 3), origin: "picked" as const };
  expect(replacedLabel(v, currentCandidate(v, draftElsewhere))).toBeNull();
});

it("warns exactly when the confirmation would change the saved label", () => {
  // every pair of labels: it warns iff the candidate differs from the saved one
  const all = ["no_fire", "skip", fire(0, 0), fire(0, 1), fire(1, 0), fire(0, 0, true)] as const;
  for (const saved of all) for (const next of all) {
    const v = labelled(saved);
    const got = replacedLabel(v, currentCandidate(v, picked(next)));
    expect(got !== null).toBe(JSON.stringify(saved) !== JSON.stringify(next));
  }
});
