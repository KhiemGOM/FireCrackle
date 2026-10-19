"""Save activation memory without changing batch size or BatchNorm updates."""
from contextlib import contextmanager,nullcontext
from types import MethodType
import torch
from torch import nn
from torch.utils.checkpoint import checkpoint

@contextmanager
def preserve_bn_statistics(stage):
    # Recompute must use training batch statistics for identical gradients, but
    # must not count as another observation in the running-statistic buffers.
    saved=[(m,m.running_mean.clone(),m.running_var.clone(),m.num_batches_tracked.clone()) for m in stage.modules() if isinstance(m,nn.modules.batchnorm._BatchNorm) and m.track_running_stats]
    try:yield
    finally:
        with torch.no_grad():
            for m,mean,var,count in saved:
                m.running_mean.copy_(mean);m.running_var.copy_(var);m.num_batches_tracked.copy_(count)

def checkpointed_forward(self,x):
    x=self.maxpool(self.relu(self.bn1(self.conv1(x))))
    for stage in [self.layer1,self.layer2,self.layer3,self.layer4]:
        if self.training and torch.is_grad_enabled():
            # Bound recomputation peaks inside long ResNet101 stages too.
            width=1 if stage is self.layer1 else 2 if stage is self.layer2 else 4
            blocks=list(stage.children())
            for begin in range(0,len(blocks),width):
                chunk=nn.Sequential(*blocks[begin:begin+width])
                x=checkpoint(chunk,x,use_reentrant=False,context_fn=lambda s=chunk:(nullcontext(),preserve_bn_statistics(s)))
        else:x=stage(x)
    return self.fc(torch.flatten(self.avgpool(x),1))

def enable(model):
    model.forward=MethodType(checkpointed_forward,model)
    return model
