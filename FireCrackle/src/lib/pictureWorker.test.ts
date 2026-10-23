import {afterEach,expect,it,vi} from 'vitest';
import {pictureTask,resetPictureWorkers} from './pictureWorker';
import * as tasks from './pictureTasks';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();resetPictureWorkers();});

it('without workers (tests, old hosts) a picture task runs right here, with the same result',async()=>{
  const run=vi.spyOn(tasks,'runPictureTask').mockResolvedValue(0.25);
  expect(await pictureTask('change',{before:'data:a',after:'data:b',screens:[]})).toBe(0.25);
  expect(run).toHaveBeenCalledWith('change',{before:'data:a',after:'data:b',screens:[]});
});

/** A stand-in Worker: answers each message after a tick, or fails when the task says so. */
class FakeWorker{
  static made:FakeWorker[]=[];
  onmessage:((e:{data:unknown})=>void)|null=null;onerror:((e:unknown)=>void)|null=null;sent:unknown[]=[];
  constructor(){FakeWorker.made.push(this);}
  postMessage(message:{id:number;task:string;args:{fail?:boolean;value?:number}}){
    this.sent.push(message);
    setTimeout(()=>this.onmessage?.({data:message.args.fail?{id:message.id,error:'decode failed'}:{id:message.id,result:message.args.value}}),0);
  }
  terminate(){}
}

it('with workers, tasks leave the UI thread, and each answer reaches the task that asked for it',async()=>{
  FakeWorker.made=[];vi.stubGlobal('Worker',FakeWorker);
  const run=vi.spyOn(tasks,'runPictureTask');
  const [a,b,c]=await Promise.all([1,2,3].map(value=>pictureTask('change',{value} as never)));
  expect([a,b,c]).toEqual([1,2,3]);
  expect(run).not.toHaveBeenCalled();
  expect(FakeWorker.made.length).toBeGreaterThan(0);
  expect(FakeWorker.made.length).toBeLessThanOrEqual(2);
});
it('a failed task rejects with the worker\'s message and later tasks still work',async()=>{
  FakeWorker.made=[];vi.stubGlobal('Worker',FakeWorker);
  await expect(pictureTask('change',{fail:true} as never)).rejects.toThrow('decode failed');
  expect(await pictureTask('change',{value:7} as never)).toBe(7);
});
