"""Variant of the frozen no-fire ONNX graph that takes uint8 pixels and casts to
float32 inside the graph: the host uploads 150 KB per view instead of 600 KB and
skips the u8 -> f32 copy. Cast is exact, so the scores are unchanged.

  python make_u8_model.py SRC.onnx DST.onnx
"""
import sys
import onnx
from onnx import TensorProto, helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
pixels = g.input[0]
assert pixels.name == 'pixels' and pixels.type.tensor_type.elem_type == TensorProto.FLOAT
pixels.type.tensor_type.elem_type = TensorProto.UINT8
cast = helper.make_node('Cast', ['pixels'], ['pixels_f32'], to=TensorProto.FLOAT, name='pixels_cast')
for n in g.node:
    for i, name in enumerate(n.input):
        if name == 'pixels':
            n.input[i] = 'pixels_f32'
g.node.insert(0, cast)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('saved', dst)
