"""Portable numpy inference for frozen frame-feature MLPs; no training framework needed."""
import json
import numpy as np

def predict(model,x):
 x=np.asarray(x,dtype=np.float32)
 if x.shape[-1]!=len(model['mean']):raise ValueError('Feature schema mismatch')
 z=(x-np.asarray(model['mean']))/np.asarray(model['scale'])
 h=np.maximum(0,z@np.asarray(model['w1']).T+np.asarray(model['b1']))
 logits=h@np.asarray(model['w2']).T+np.asarray(model['b2'])
 return 1/(1+np.exp(-np.clip(logits[...,0],-80,80)))

def export_model(model,mean,scale,threshold,path):
 weights={k:v.detach().cpu().numpy().tolist() for k,v in model.state_dict().items()}
 data={'version':1,'status':'research_only','score':'fire evidence, not calibrated probability','mean':mean.tolist(),'scale':scale.tolist(),'w1':weights['0.weight'],'b1':weights['0.bias'],'w2':weights['3.weight'],'b2':weights['3.bias'],'threshold':threshold}
 path.write_text(json.dumps(data));return data
