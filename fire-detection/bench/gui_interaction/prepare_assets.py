"""Build local GUI template packs from installed client textures, not footage.

These are vanilla source assets, not synthetic-fire data or learned checkpoints.
Do not commit the output. Source metadata/dimensions are audited in the GUI catalogue.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image, ImageDraw

PANELS = [
    ('inventory', 'inventory', 176,166,True),
    ('crafting','crafting_table',176,166,True),
    ('crafter','crafter',176,166,False),
    ('furnace','furnace',176,166,True),
    ('blast_furnace','blast_furnace',176,166,True),
    ('smoker','smoker',176,166,True),
    ('brewing_stand','brewing_stand',176,166,False),
    ('enchantment','enchanting_table',176,166,False),
    ('anvil','anvil',176,166,False),
    ('grindstone','grindstone',176,166,False),
    ('smithing','smithing',176,166,False),
    ('stonecutter','stonecutter',176,166,False),
    ('loom','loom',176,166,False),
    ('cartography_table','cartography_table',176,166,False),
    ('beacon','beacon',230,219,False),
    ('hopper','hopper',176,133,False),
    ('dispenser','dispenser',176,166,False),
    # ShulkerBoxScreen increments the base 166px backgroundHeight.
    ('shulker_box','shulker_box',176,167,False),
    ('merchant','villager',276,166,False),
    ('horse_inventory','horse',176,166,False),
    ('creative_mode_inventory','creative_inventory/tab_items',195,136,False),
    ('creative_mode_inventory','creative_inventory/tab_item_search',195,136,False),
    ('creative_mode_inventory','creative_inventory/tab_inventory',195,136,False),
]


def prepare(client, version, output):
    rows=[]
    with zipfile.ZipFile(client) as jar:
        def texture(name):
            data=jar.read('assets/minecraft/textures/gui/container/'+name+'.png')
            return Image.open(io.BytesIO(data)).convert('RGBA'), hashlib.sha256(data).hexdigest()
        def save(kind,variant,image,shift,source_hash):
            filename=version+'-'+kind+'-'+variant.replace('/','_')+'.guit'
            kind='inventory.'+kind+'_screen'
            width,height=image.size
            header=f'GUIT1\n{kind}\n{version}\n{variant}\n{width} {height} {int(shift)}\n'.encode()
            (output/filename).write_bytes(header+image.tobytes())
            rows.append({'file':filename,'screen_type':kind,'version':version,'variant':variant,'width':width,'height':height,'source_sha256':source_hash})
        for kind,name,w,h,shift in PANELS:
            try: image,source_hash=texture(name)
            except KeyError: continue
            canvas=image.crop((0,0,w,h))
            # Dynamic entity/armor previews cannot identify the static panel.
            if kind in ('inventory','horse_inventory'):
                box=(25,7,80,75) if kind=='inventory' else (6,16,79,72)
                ImageDraw.Draw(canvas).rectangle(box,fill=(0,0,0,0))
            save(kind,name,canvas,shift,source_hash)
        image,source_hash=texture('generic_54')
        for n in range(1,7):
            canvas=Image.new('RGBA',(176,114+18*n))
            split=17+18*n
            canvas.paste(image.crop((0,0,176,split)),(0,0))
            canvas.paste(image.crop((0,126,176,222)),(0,split))
            save('container','generic_9x'+str(n),canvas,False,source_hash)
    return rows


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    cache=Path.home()/'.gradle/caches/fabric-loom'
    rows=[]
    for version in ['1.16.5','1.21.11']:
        rows+=prepare(cache/version/'minecraft-client.jar',version,args.output)
    (args.output/'manifest.json').write_text(json.dumps({'producer':'prepare_assets.py','not_training_data':True,'templates':rows},indent=2),encoding='utf-8')
    print(f'{len(rows)} source templates, {len(set(r["screen_type"] for r in rows))} known screen classes')

if __name__=='__main__': main()
