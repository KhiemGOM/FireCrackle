"""Give the frozen no-fire ONNX graph a symbolic batch dimension so one session run can
score all nine views of a frame. Weights and ops are untouched; the graph already
contains its own 0-255 -> normalised preprocessing (Transpose/Div/Sub at the head).

  python make_batched_model.py SRC.onnx DST.onnx
"""
import sys
import onnx

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
for v in list(m.graph.input) + list(m.graph.output):
    v.type.tensor_type.shape.dim[0].dim_param = 'N'
    v.type.tensor_type.shape.dim[0].ClearField('dim_value')
# A fixed reshape/flatten with batch 1 would break; the graph's only shape op is the
# final Squeeze of the Gemm output's feature axis, which shape inference confirms below.
for n in m.graph.node:
    assert n.op_type not in ('Reshape', 'Flatten', 'Unsqueeze'), n.op_type
onnx.checker.check_model(m)
m = onnx.shape_inference.infer_shapes(m, strict_mode=True)
out = m.graph.output[0].type.tensor_type.shape.dim
assert len(out) == 1 and out[0].dim_param == 'N', [(d.dim_param, d.dim_value) for d in out]
onnx.save(m, dst)
print('saved', dst, [(i.name, [d.dim_param or d.dim_value for d in i.type.tensor_type.shape.dim]) for i in m.graph.input],
      [(o.name, [d.dim_param or d.dim_value for d in o.type.tensor_type.shape.dim]) for o in m.graph.output])
