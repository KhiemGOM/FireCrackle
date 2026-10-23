// Runs lib/pictureTasks.ts off the UI thread: one message per task, answered with its id.
import {runPictureTask,type PictureTask} from './pictureTasks';
import {failureMessage} from './appErrors';
self.onmessage=async(e:MessageEvent<{id:number;task:PictureTask;args:never}>)=>{
  const {id,task,args}=e.data;
  try{self.postMessage({id,result:await runPictureTask(task,args)});}
  catch(error){self.postMessage({id,error:failureMessage(error)});}
};
