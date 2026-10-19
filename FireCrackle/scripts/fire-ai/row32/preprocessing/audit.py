"""Recount the cached result and verify choices reproduce calibration-only rules."""
import json
from pathlib import Path
import numpy as np
import torch
from run import OUT,DATA,OLD,VARIANTS,choose_weight,probability_metrics

def main():
    torch.set_num_threads(4);report=json.loads((OUT/'results.json').read_text());data=np.load(DATA/'real.npz');selection=report['selection'];cached=np.load(OUT/'predictions.npz');ci=cached['calibration_indices'];ti=cached['indices'];cy=torch.tensor(data['y'][ci]);y=torch.tensor(data['y'][ti]);old=np.load(OLD/'resnet101/predictions.npz')
    calibration={name:torch.tensor(np.load(OUT/f'calibration-{name}.npz')['logits']).softmax(1) for name in VARIANTS}
    losses={name:probability_metrics(p,cy)['loss'] for name,p in calibration.items()}
    assert selection['variant']==min(VARIANTS,key=lambda n:losses[n])
    weight,_=choose_weight(torch.tensor(old['calibration_logits']).softmax(1),calibration[selection['variant']],cy)
    assert weight==selection['weight128']
    for key,field in [('preprocessed128','chosen_probabilities'),('ensemble','ensemble_probabilities')]:
        p=torch.tensor(cached[field]);actual=probability_metrics(p,y);expected=report['test'][key]
        assert actual['correct']==expected['correct'];assert actual['top3']==expected['top3'];assert abs(actual['loss']-expected['loss'])<1e-6
        accept=p.max(1).values>=expected['gate']['threshold'];good=p.argmax(1)==y
        assert int((accept&good).sum())==expected['gate']['correct'];assert int((accept&~good).sum())==expected['gate']['wrong']
    print(json.dumps(dict(passed=True,calibration=len(ci),test=len(ti),chosen_variant=selection['variant'],weight128=weight,preprocessed_correct=report['test']['preprocessed128']['correct'],ensemble_correct=report['test']['ensemble']['correct'])))

if __name__=='__main__':main()
