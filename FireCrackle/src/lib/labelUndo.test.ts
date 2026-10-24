import {expect,it,vi} from 'vitest';
import {LabelUndo} from './labelUndo';
const tick=async()=>{await Promise.resolve();};

it('undoes mixed tool and real label edits in action order',async()=>{
  const history=new LabelUndo(),events:string[]=[];
  history.record('quad',()=>{events.push('quad');});await tick();
  history.observeLabels(1,()=>{events.push('label');});await tick();
  history.record('ruler',()=>{events.push('ruler');});await tick();
  await history.undo();await history.undo();await history.undo();
  expect(events).toEqual(['ruler','label','quad']);expect(history.size).toBe(0);
});
it('coalesces one whole pointer drag and a multi-setting toggle into one step',async()=>{
  const history=new LabelUndo();let quad=1,opacity=.5;
  history.bind<number>('quad',v=>{quad=v;});history.bind<number>('opacity',v=>{opacity=v;});
  history.beginGesture();history.changed('quad',quad,2);quad=2;await tick();
  history.changed('quad',quad,3);quad=3;await tick();history.changed('opacity',opacity,1);opacity=1;
  history.endGesture();await tick();expect(history.size).toBe(1);
  await history.undo();expect([quad,opacity]).toEqual([1,.5]);
});
it('keeps async label acknowledgements at their original place before later tool edits',async()=>{
  const history=new LabelUndo(),events:string[]=[];
  const ticket=history.checkpoint();
  history.record('quad',()=>{events.push('quad');});await tick();
  history.observeLabels(1,()=>{events.push('label');},ticket);
  await history.undo();await history.undo();expect(events).toEqual(['quad','label']);
});
it('ignores no-op state writes, unchanged native depths and automatic frame previews',async()=>{
  const history=new LabelUndo(),restore=vi.fn();history.bind('quad',restore);
  history.changed('quad',[1,2],[1,2]);history.observeLabels(0,restore);
  history.ignore(()=>history.changed('quad',1,2));expect(history.size).toBe(0);
  history.changed('quad',1,2);await tick();
  history.observeLabels(0,restore);expect(history.size).toBe(1);
  await history.undo();expect(restore).toHaveBeenCalledExactlyOnceWith(1);
});
it('uses fresh bindings after a tab remount, suppresses replay recording, and resets on another video',async()=>{
  const history=new LabelUndo(),old=vi.fn(),fresh=vi.fn(()=>history.changed('quad',2,1));
  history.bind('quad',old);history.changed('quad',1,2);await tick();history.bind('quad',fresh);
  await history.undo();expect(old).not.toHaveBeenCalled();expect(fresh).toHaveBeenCalledWith(1);expect(history.size).toBe(0);
  history.changed('quad',1,2);history.clear(9);history.observeLabels(9,vi.fn());expect(history.size).toBe(0);
});
it('retains the last entry after a failed undo and fences repeated undo while it runs',async()=>{
  const history=new LabelUndo(),restore=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
  history.record('label',restore);await expect(history.undo()).rejects.toThrow('offline');expect(history.size).toBe(1);
  await history.undo();expect(history.size).toBe(0);
  let finish!:()=>void;history.record('slow',()=>new Promise<void>(resolve=>{finish=resolve;}));
  const pending=history.undo();await history.undo();expect(history.size).toBe(1);finish();await pending;expect(history.size).toBe(0);
});
it('records background label batches while another tab is active, but ignores that tab’s local UI',async()=>{
  const history=new LabelUndo(),restore=vi.fn();history.enabled=false;
  history.record('other-tab',restore);history.observeLabels(1,restore);
  expect(history.size).toBe(1);expect(history.enabled).toBe(false);
  await history.undo();expect(restore).toHaveBeenCalledOnce();
});
it('keeps new tool edits made while an async native undo is waiting',async()=>{
  const history=new LabelUndo(),tool=vi.fn();let finish!:()=>void;
  history.record('native',()=>new Promise<void>(resolve=>{finish=resolve;}));
  const pending=history.undo();history.record('new tool',tool);finish();await pending;
  expect(history.size).toBe(1);await history.undo();expect(tool).toHaveBeenCalledOnce();
});
it('groups actual pointer events until release, then starts a separate action',async()=>{
  const history=new LabelUndo(),target=new EventTarget(),stop=history.attach(target as Window),restore=vi.fn();
  target.dispatchEvent(new Event('pointerdown'));history.record('quad',restore);await tick();history.record('quad',restore);
  target.dispatchEvent(new Event('pointerup'));await tick();history.record('other',restore);await tick();
  expect(history.size).toBe(2);stop();await history.undo();await history.undo();expect(restore).toHaveBeenCalledTimes(2);
});

it('redoes an undone edit with the value it had',async()=>{
  const history=new LabelUndo();let quad=1;history.bind<number>('quad',v=>{quad=v;});
  history.changed('quad',quad,2);quad=2;await tick();
  await history.undo();expect(quad).toBe(1);expect(history.redoSize).toBe(1);
  await history.redo();expect(quad).toBe(2);expect(history.size).toBe(1);expect(history.redoSize).toBe(0);
  await history.undo();expect(quad).toBe(1);
});
it('redoes a whole gesture to its final values',async()=>{
  const history=new LabelUndo();let quad=1,opacity=.5;
  history.bind<number>('quad',v=>{quad=v;});history.bind<number>('opacity',v=>{opacity=v;});
  history.beginGesture();history.changed('quad',quad,2);quad=2;await tick();
  history.changed('quad',quad,3);quad=3;history.changed('opacity',opacity,1);opacity=1;history.endGesture();await tick();
  await history.undo();expect([quad,opacity]).toEqual([1,.5]);
  await history.redo();expect([quad,opacity]).toEqual([3,1]);
});
it('redoes steps in the order they were undone, newest undo first',async()=>{
  const history=new LabelUndo(),events:string[]=[];
  history.record('a',()=>{events.push('undo a');},undefined,()=>{events.push('redo a');});await tick();
  history.record('b',()=>{events.push('undo b');},undefined,()=>{events.push('redo b');});await tick();
  await history.undo();await history.undo();await history.redo();await history.redo();
  expect(events).toEqual(['undo b','undo a','redo a','redo b']);
});
it('a new edit after an undo drops what could be redone',async()=>{
  const history=new LabelUndo();let quad=1,ruler=0;
  history.bind<number>('quad',v=>{quad=v;});history.bind<number>('ruler',v=>{ruler=v;});
  history.changed('quad',quad,2);quad=2;await tick();await history.undo();
  history.changed('ruler',ruler,5);ruler=5;await tick();
  expect(history.redoSize).toBe(0);await history.redo();expect(quad).toBe(1);
});
it('redoing a label edit does not count the restored label as a new edit',async()=>{
  const history=new LabelUndo(),redoNative=vi.fn(async()=>{history.observeLabels(1,undoNative,undefined,redoNative);});
  const undoNative=vi.fn(async()=>{history.observeLabels(0,undoNative,undefined,redoNative);});
  history.observeLabels(1,undoNative,undefined,redoNative);await tick();
  await history.undo();expect(undoNative).toHaveBeenCalledOnce();expect(history.size).toBe(0);
  await history.redo();expect(redoNative).toHaveBeenCalledOnce();expect(history.size).toBe(1);expect(history.redoSize).toBe(0);
  await history.undo();expect(undoNative).toHaveBeenCalledTimes(2);
});
it('nothing to redo does nothing; a failed redo stays redoable; another video drops redo',async()=>{
  const history=new LabelUndo(),redo=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
  await history.redo();
  history.record('label',vi.fn(),undefined,redo);await tick();await history.undo();
  await expect(history.redo()).rejects.toThrow('offline');expect(history.redoSize).toBe(1);
  await history.redo();expect(history.redoSize).toBe(0);expect(history.size).toBe(1);
  await history.undo();history.clear(0);expect(history.redoSize).toBe(0);
});
