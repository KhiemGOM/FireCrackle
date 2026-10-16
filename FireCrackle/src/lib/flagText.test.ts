import { describe,it,expect } from "vitest";
import { flagText,priorityHint } from "./flagText";
describe("phase evidence wording",()=>{
  it('identifies report evidence separately from fire severity',()=>{
    expect(priorityHint('jolt')).toContain('Imported Jolt report');
    expect(priorityHint('jolt')).not.toContain('Large timing discrepancy');
  });
  it("explains forward transition evidence instead of calling it baseline phase mismatch",()=>{
    expect(flagText("phase_shift","forward_jump: At least 30 forward ticks in one frame.")).toEqual({name:"Forward animation jump",hint:"At least 30 forward ticks in one frame."});
  });
  it("a hard flag can be lag and never claims editing is proved",()=>{
    expect(priorityHint("hard")).toMatch(/lag/i);
    expect(priorityHint("hard")).not.toMatch(/proven|impossible|labelling error/i);
  });
  it("describes recovery and mismatch separately",()=>{
    expect(flagText("phase_excursion","recovered_hold").hint).toMatch(/original clock/i);
    expect(flagText("phase_excursion","hold_with_mismatch").hint).toMatch(/mismatch/i);
    expect(flagText("phase_outlier").hint).not.toMatch(/probably|proven/i);
  });
});
