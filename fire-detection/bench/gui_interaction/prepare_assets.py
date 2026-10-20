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

# Vanilla 1.21.11 official-name classes whose rendering/layout rules are used
# below. Local packs record class hashes so code provenance is reproducible.
SOURCE_RULE_CLASSES = {
    'BookEditScreen':'gtq', 'BookSignScreen':'gtr', 'BookViewScreen':'gts',
    'LecternScreen':'guo', 'AbstractSignEditScreen':'gtm',
    'HangingSignEditScreen':'gui', 'PauseScreen':'grx', 'OptionsScreen':'gwb',
    'OptionsSubScreen':'gwc', 'AccessibilityOptionsScreen':'gvv',
    'AbstractLayout':'gop', 'FrameLayout':'gos', 'GridLayout':'got',
    'HeaderAndFooterLayout':'gou', 'GuiGraphics':'gir', 'GuiSpriteScaling':'ine',
}

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


def prepare(client, version, output, families=None):
    rows=[]
    with zipfile.ZipFile(client) as jar:
        def texture(name):
            data=jar.read('assets/minecraft/textures/gui/container/'+name+'.png')
            return Image.open(io.BytesIO(data)).convert('RGBA'), hashlib.sha256(data).hexdigest()
        def save(kind,variant,image,shift,source_hash,layout=(0,-1),identity=()):
            filename=version+'-'+kind+'-'+variant.replace('/','_')+'.guit'
            kind=kind if '.' in kind or kind=='pause_screen' else 'inventory.'+kind+'_screen'
            width,height=image.size
            header=(f'GUIT2\n{kind}\n{version}\n{variant}\n{width} {height} {int(shift)}\n'
                    f'{layout[0]} {layout[1]} {len(identity)} {layout[2] if len(layout)>2 else 0}\n'+
                    ''.join(f'{p[0]} {p[1]} {p[2][0]} {p[2][1]} {p[2][2]} {p[3] if len(p)>3 else 0}\n' for p in identity)).encode()
            (output/filename).write_bytes(header+image.tobytes())
            rows.append({'file':filename,'screen_type':kind,'version':version,'variant':variant,'width':width,'height':height,'source_sha256':source_hash,
                         'layout':layout,'identity_anchors':len(identity)})
        for kind,name,w,h,shift in PANELS:
            if families is not None and kind not in families:
                continue
            try: image,source_hash=texture(name)
            except KeyError: continue
            canvas=image.crop((0,0,w,h))
            # Dynamic entity/armor previews cannot identify the static panel.
            if kind in ('inventory','horse_inventory'):
                box=(25,7,80,75) if kind=='inventory' else (6,16,79,72)
                ImageDraw.Draw(canvas).rectangle(box,fill=(0,0,0,0))
            save(kind,name,canvas,shift,source_hash)
        if families is not None:
            return rows
        image,source_hash=texture('generic_54')
        for n in range(1,7):
            canvas=Image.new('RGBA',(176,114+18*n))
            split=17+18*n
            canvas.paste(image.crop((0,0,176,split)),(0,0))
            canvas.paste(image.crop((0,126,176,222)),(0,split))
            save('container','generic_9x'+str(n),canvas,False,source_hash)
        # Books render at logical y=2, not at the screen centre. Their writable
        # content is arbitrary; only the source border and fixed control labels
        # identify them. Never use renameable container titles as type evidence.
        if version == '1.21.11':
            data=jar.read('assets/minecraft/textures/gui/book.png')
            book=Image.open(io.BytesIO(data)).convert('RGBA').crop((20,1,166,181))
            ImageDraw.Draw(book).rectangle((15,12,132,148),fill=(0,0,0,0))
            font_data=jar.read('assets/minecraft/textures/font/ascii.png')
            font=Image.open(io.BytesIO(font_data)).convert('RGBA')
            provider_data=jar.read('assets/minecraft/font/include/default.json')
            providers=json.loads(provider_data)['providers']
            provider=next(p for p in providers if p.get('file')=='minecraft:font/ascii.png')
            chars={ch:(x,y) for y,row in enumerate(provider['chars']) for x,ch in enumerate(row) if ch!='\x00'}
            lang_data=jar.read('assets/minecraft/lang/en_us.json')
            language=json.loads(lang_data)
            def glyph(ch):
                if ch==' ':return [],4
                cx,cy=chars[ch]
                pixels=[(x,y) for y in range(8) for x in range(8) if font.getpixel((cx*8+x,cy*8+y))[3]>0]
                return pixels,max((x+1 for x,y in pixels),default=0)+1
            def control(key,center,y=199):
                text=language[key]
                x=center-sum(glyph(ch)[1] for ch in text)//2
                pixels=[]
                for ch in text:
                    points,advance=glyph(ch)
                    pixels += [(x+px+0.5,y+py+0.5,(255,255,255)) for px,py in points]
                    x+=advance
                return pixels
            # Relative to cropped book: its centre is screen centre minus 3.
            # Buttons use screen-relative centres -51, +51, or 0.
            dependencies=hashlib.sha256(data+font_data+provider_data+lang_data).hexdigest()
            for kind,key,center in [('book_edit','book.signButton',25),
                                    ('book_sign','gui.cancel',127),
                                    ('book_view','gui.done',76),
                                    ('lectern','lectern.take_book',127)]:
                save(kind,'book_en_us',book,False,dependencies,(-3,3),control(key,center))
            for path in sorted(jar.namelist()):
                if not path.startswith('assets/minecraft/textures/gui/hanging_signs/') or not path.endswith('.png'):
                    continue
                data=jar.read(path)
                # HangingSignEditScreen: translate to (W/2,125), then -13 Y;
                # draw a 16px texture at (-8,-8) with a 4.5 multiplier.
                sign=Image.open(io.BytesIO(data)).convert('RGBA').resize((72,72),Image.Resampling.NEAREST)
                # Four editable lines span this area, regardless of content.
                ImageDraw.Draw(sign).rectangle((6,33,66,70),fill=(0,0,0,0))
                save('hanging_sign_edit','hanging_sign/'+Path(path).stem,sign,False,
                     hashlib.sha256(data+font_data+provider_data+lang_data).hexdigest(),(0,76),
                     control('hanging_sign.edit',36,-36))
            # HeaderAndFooterLayout: a 9px heading is centred in the 33px
            # header (y=12); the 20px Done button is centred in the 33px
            # footer (y=H-26): AbstractLayout's vertical placement uses
            # Math.round((33-20)/2), unlike its horizontal truncation.
            # OptionsScreen's taller header also places its
            # heading at y=12, above its extra controls. Content is not fixed.
            for skin in ['button','button_highlighted']:
                data=jar.read(f'assets/minecraft/textures/gui/sprites/widget/{skin}.png')
                scaling_data=jar.read(f'assets/minecraft/textures/gui/sprites/widget/{skin}.png.mcmeta')
                scaling=json.loads(scaling_data)['gui']['scaling']
                if scaling != {'type':'nine_slice','width':200,'height':20,'border':3}:
                    raise ValueError('Button source scaling changed; re-audit GuiGraphics before generating packs')
                control_hash=hashlib.sha256(data+scaling_data+font_data+provider_data+lang_data).hexdigest()
                source_button=Image.open(io.BytesIO(data)).convert('RGBA')
                def button_patch(width):
                    button=Image.new('RGBA',(width,40))
                    # GuiSpriteScaling.NineSlice defaults stretch_inner=false.
                    # GuiGraphics preserves 3px sides and TILES its 194px
                    # centre, cropping the last tile; it does not resize it.
                    button.paste(source_button.crop((0,0,3,20)),(0,0))
                    button.paste(source_button.crop((197,0,200,20)),(width-3,0))
                    for x in range(3,width-3):
                        source_x=3+(x-3)%194
                        button.paste(source_button.crop((source_x,0,source_x+1,20)),(x,0))
                    ImageDraw.Draw(button).rectangle((8,4,width-9,15),fill=(0,0,0,0))
                    return button
                for kind,key in [('options.options_screen','options.title'),
                                 ('options.accessibility_options_screen','options.accessibility.title'),
                                 ('options.chat_options_screen','options.chat.title'),
                                 ('options.controls.controls_screen','controls.title'),
                                 ('options.skin_customization_screen','options.skinCustomisation.title'),
                                 ('options.sound_options_screen','options.sounds.title')]:
                    width,offset=(150,79) if 'accessibility' in kind else (200,0)
                    identity=control('gui.done',width//2,6)
                    identity += [(x,y,rgb,-1) for x,y,rgb in control(key,width//2-offset,38)]
                    save(kind,'fixed_controls_en_us_'+skin,button_patch(width),False,
                         control_hash,(offset,-26,1),identity)
                # PauseScreen's 166px grid is aligned at 1/4 viewport height;
                # its first button has 50px top padding. The fixed heading
                # stays at y=40, independent of the grid's viewport position.
                identity=control('menu.returnToGame',102,6)
                identity += [(x,y,rgb,-0.25) for x,y,rgb in control('menu.game',102,31.5)]
                save('pause_screen','fixed_controls_en_us_'+skin,
                     button_patch(204),False,control_hash,(0,8.5,0.25),identity)
                # AbstractSignEditScreen has Done at H/4+144 and title at 40.
                # HangingSignEditScreen inherits those controls; only its
                # fixed heading differs. User-written sign text is excluded.
                for kind,key in [('sign_edit','sign.edit'),
                                 ('hanging_sign_edit','hanging_sign.edit')]:
                    identity=control('gui.done',100,6)
                    identity += [(x,y,rgb,-0.25) for x,y,rgb in control(key,100,-104)]
                    save(kind,'fixed_controls_en_us_'+skin,button_patch(200),False,
                         control_hash,(0,144,0.25),identity)
    return rows


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--client-1165',type=Path)
    parser.add_argument('--client-12111',type=Path)
    parser.add_argument('--bundle',type=Path)
    parser.add_argument('--variant-client',action='append',default=[],metavar='VERSION=JAR',
                        help='Audited intermediate artwork variants; shared geometry, no separate detector')
    args=parser.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    cache=Path.home()/'.gradle/caches/fabric-loom'
    rows=[]
    clients={'1.16.5':args.client_1165 or cache/'1.16.5/minecraft-client.jar',
             '1.21.11':args.client_12111 or cache/'1.21.11/minecraft-client.jar'}
    for version in ['1.16.5','1.21.11']:
        rows+=prepare(clients[version],version,args.output)
    # Notice-board source audit: stable base panels need no release-specific
    # copies. Only these artwork generations add evidence not in the endpoints.
    variants={'1.17':{'brewing_stand'},
              '1.18':{'anvil','grindstone','enchantment'}}
    for item in args.variant_client:
        version,client=item.split('=',1)
        if version not in variants:
            raise ValueError('Unaudited GUI compatibility profile: '+version)
        rows+=prepare(Path(client),version,args.output,variants[version])
    stale={p.name for p in args.output.glob('*.guit')}-{r['file'] for r in rows}
    if stale:
        raise RuntimeError('Stale GUI packs in output; use a fresh directory: '+', '.join(sorted(stale)))
    with zipfile.ZipFile(clients['1.21.11']) as jar:
        evidence={name:{'official_obfuscated_class':obf,'sha256':hashlib.sha256(jar.read(obf+'.class')).hexdigest()}
                  for name,obf in SOURCE_RULE_CLASSES.items()}
    (args.output/'manifest.json').write_text(json.dumps({'producer':'prepare_assets.py','not_training_data':True,
        'source_rule_version':'1.21.11','source_rule_classes':evidence,
        'compatibility_scope':'Audited ordinary vanilla base-panel artwork 1.16.5–1.21.11; not exhaustive rendered-state or accuracy coverage',
        'intermediate_artwork':variants and {k:sorted(v) for k,v in variants.items()},
        'templates':rows},indent=2),encoding='utf-8')
    if args.bundle:
        args.bundle.parent.mkdir(parents=True,exist_ok=True)
        with args.bundle.open('wb') as stream:
            for row in sorted(rows,key=lambda row:row['file']):
                data=(args.output/row['file']).read_bytes()
                stream.write(len(data).to_bytes(4,'little'));stream.write(data)
    print(f'{len(rows)} source templates, {len(set(r["screen_type"] for r in rows))} known screen classes')

if __name__=='__main__': main()
