"""Single outlined RGB crop ->32 animation phases. No material/time metadata input."""
import torch
from torch import nn
from torchvision.models import resnet18,ResNet18_Weights

def make_model(pretrained=False):
    model=resnet18(weights=ResNet18_Weights.DEFAULT if pretrained else None)
    # Preserve spatial texture detail at64x64; weights themselves remain reusable.
    model.conv1.stride=(1,1);model.maxpool=nn.Identity()
    model.avgpool=nn.AdaptiveAvgPool2d((2,2));model.fc=nn.Linear(512*4,32)
    return model

def normalize(rgb):
    mean=rgb.new_tensor([.485,.456,.406])[None,:,None,None]
    std=rgb.new_tensor([.229,.224,.225])[None,:,None,None]
    return (rgb-mean)/std
