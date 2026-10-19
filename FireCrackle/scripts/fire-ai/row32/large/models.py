"""Larger32-phase backbones; same64px RGB input and ImageNet normalization."""
from pathlib import Path
import torch
from torch import nn
from torchvision.models import resnet101,vit_b_16,ViT_B_16_Weights
from torchvision.models.vision_transformer import interpolate_embeddings

def make_model(name,pretrained=False,cache=None):
    if name=='resnet101':
        model=resnet101(weights=None)
        if pretrained:
            source=Path.home()/'.cache/torch/hub/checkpoints/resnet101-63fe2227.pth'
            model.load_state_dict(torch.load(source,map_location='cpu',weights_only=True))
        model.conv1.stride=(1,1);model.maxpool=nn.Identity();model.avgpool=nn.AdaptiveAvgPool2d((2,2));model.fc=nn.Linear(2048*4,32)
        return model
    if name=='vit_b16':
        model=vit_b_16(weights=None,image_size=64)
        if pretrained:
            if cache:torch.hub.set_dir(str(Path(cache)/'torch'))
            state=ViT_B_16_Weights.DEFAULT.get_state_dict(progress=False,check_hash=True)
            state=interpolate_embeddings(image_size=64,patch_size=16,model_state=state,reset_heads=True)
            missing,unexpected=model.load_state_dict(state,strict=False)
            if set(missing)!={'heads.head.weight','heads.head.bias'} or unexpected:raise ValueError((missing,unexpected))
        model.heads.head=nn.Linear(768,32)
        return model
    raise ValueError(name)
