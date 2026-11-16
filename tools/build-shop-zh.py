#!/usr/bin/env python3
"""Localize native CS touch menus using text textures; legacy fonts are 8-bit.

Only presentation labels change. Native button names, commands, item prices,
selection aliases and all purchase decisions remain in the original engine.
"""
import os
import hashlib
import io
import json
import pathlib
import re
import zipfile
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCE = pathlib.Path(os.environ['CS16_SDK_DIR']) / '3rdparty/cs16client-extras/touch'
OUTPUT = ROOT / 'web/public/ui/menus-zh-v1.zip'
FONT_PATH = os.environ.get('CS16_FONT','/System/Library/Fonts/STHeiti Medium.ttc')
FONT = ImageFont.truetype(FONT_PATH, 40)
LINE = 46
SCALE = 2
WIDTH, HEIGHT = 1280, 720
LABELS = {
    'BUY MENU':'装备商店','SHOP BY CATEGORY':'选择装备分类','0 CANCEL':'0 取消',
    '1 PISTOLS':'1 手枪','2 SHOTGUNS':'2 霰弹枪','3 SMG':'3 冲锋枪',
    '4 RIFLES':'4 步枪','5 MACHINE GUNS':'5 机枪','6 PRIMARY AMMO':'6 主武器弹药',
    '7 SECONDARY AMMO':'7 副武器弹药','8 EQUIPMENT':'8 装备',
    'A AUTO-BUY':'A 自动购买','R RE-BUY PREVIOUS':'R 重复上次购买','BUY THE ITEM':'购买装备',
    'BUY EQUIPMENT':'购买装备','BUY PISTOLS (SECONDARY WEAPON)':'购买手枪 · 副武器',
    'BUY SHOTGUNS (PRIMARY WEAPON)':'购买霰弹枪 · 主武器',
    'BUY SUBMACHINE GUNS (PRIMARY WEAPON)':'购买冲锋枪 · 主武器',
    'BUY RIFLES (PRIMARY WEAPON)':'购买步枪 · 主武器',
    'BUY MACHINE GUNS (PRIMARY WEAPON)':'购买机枪 · 主武器',
    'PRICE':'价格','COUNTRY OF ORIGIN':'产地','CALIBER':'口径','CLIP CAPACITY':'弹匣容量',
    'RATE OF FIRE':'射速','WEIGHT (LOADED)':'满载重量','WEIGHT (EMPTY)':'空枪重量',
    'PROJECTILE WEIGHT':'弹头重量','MUZZLE VELOCITY':'枪口初速','MUZZLE ENERGY':'枪口动能',
    'DESCRIPTION':'装备说明','N/A':'暂无数据',
    'AUSTRIA':'奥地利','BELGIUM':'比利时','FRANCE':'法国','GERMANY':'德国','ISRAEL':'以色列',
    'ITALY':'意大利','RUSSIA':'俄罗斯','SWITZERLAND':'瑞士','SWITZERLAND/GERMANY':'瑞士 / 德国',
    'UNITED KINGDOM':'英国','UNITED STATES OF AMERICA':'美国',
    '1 9X19MM SIDEARM':'1 Glock 18 手枪','2 K&M .45 TACTICAL':'2 USP .45 手枪',
    '3 228 COMPACT':'3 P228 手枪','4 NIGHT HAWK .50C':'4 沙漠之鹰',
    '5 ES FIVE-SEVEN':'5 Five-seveN 手枪','5 .40 DUAL ELITES':'5 双持精英手枪',
    '1 LEONE 12 GAUGE SUPER':'1 M3 霰弹枪','2 LEONE YG1265 AUTO SHOTGUN':'2 XM1014 自动霰弹枪',
    '1 INGRAM MAC-10':'1 MAC-10 冲锋枪','1 SCHMIDT MACHINE PISTOL':'1 TMP 冲锋枪',
    '2 K&M SUB-MACHINE GUN':'2 MP5 冲锋枪','3 K&M UMP45':'3 UMP45 冲锋枪','4 ES C90':'4 P90 冲锋枪',
    '1 CLARION 5.56':'1 FAMAS 步枪','1 IDF DEFENDER':'1 Galil 步枪','2 CV-47':'2 AK-47 步枪',
    '2 SCHMIDT SCOUT':'2 Scout 狙击步枪','3 SCHMIDT SCOUT':'3 Scout 狙击步枪',
    '3 MAVERICK M4A1 CARBINE':'3 M4A1 步枪','4 BULLPUP':'4 AUG 步枪','4 KRIEG 552':'4 SG552 步枪',
    '5 ES KRIEG 550 COMMANDO':'5 SG550 连狙','5 MAGNUM SNIPER RIFLE':'5 AWP 狙击步枪',
    '6 MAGNUM SNIPER RIFLE':'6 AWP 狙击步枪','6 D3/AU-1':'6 G3SG1 连狙','1 M249':'1 M249 机枪',
    '1 KEVLAR':'1 防弹衣','2 KEVLAR+HELMET':'2 防弹衣与头盔','3 FLASHBANG':'3 闪光弹',
    '4 HE GRENADE':'4 高爆手雷','5 SMOKE GRENADE':'5 烟雾弹','6 DEFUSAL KIT':'6 拆弹器',
    '6 NIGHTVISION':'6 夜视仪','7 NIGHTVISION':'7 夜视仪','8 TACTICAL SHIELD':'8 战术盾牌',
    'A Kevlar vest that protects against projectiles':'防弹衣可以减轻子弹造成的伤害。',
    'A kevlar vest and a ballistic helmet which both protect against projectiles.':'防弹衣与防弹头盔，可以减轻子弹伤害。',
    'Makes a loud noise and blinding flash when thrown at enemy (pull pin first). Useful for causing distractions before entering an area.':'闪光弹爆炸时发出强光和巨响，可使敌人短暂失明，适合突入前使用。',
    'A high-explosive device. Pull the pin, release the spoon and throw.':'高爆手雷，投掷后爆炸，对附近敌人造成伤害。',
    'A diversionary device that can be used to provide temporary cover for moving from place to place.':'烟雾弹产生烟幕，暂时遮蔽视线，掩护移动和转移。',
    'A bomb defusal kit used to speed up the bomb defusal process.':'拆弹器可以缩短拆除炸弹所需的时间。',
    'Nightvision goggles which allow the user to see more effectively in dark areas.':'夜视仪可改善黑暗区域中的视野。',
    'Barrier-type shield for street tactics and intervention.':'战术盾牌可在正面提供防护。',
}

PATTERN = re.compile(r'touch_addbutton\s+"(?P<name>[^"]+)"\s+"#(?P<text>[^"]*)"\s+"(?P<command>[^"]*)"\s+(?P<x1>[\d.-]+)\s+(?P<y1>[\d.-]+)\s+(?P<x2>[\d.-]+)\s+(?P<y2>[\d.-]+)(?P<tail>[^\r\n]*)')
images = {}
translations = {}
unknown = set()


def translate(text):
    if text in LABELS:
        return LABELS[text]
    # Equipment descriptions use semicolons as manual English line wraps.
    match = re.match(r'(:\s*\\\$\$_menu_money_item\d+);:\s*(.*)', text)
    if match:
        description = re.sub(r'\s+', ' ', match[2].replace(';', ' ')).strip()
        if description in LABELS:
            return match[1] + ';' + LABELS[description]
        if re.search(r'[a-z]{3,}',description):
            unknown.add(description)
            return text
    parts = text.split(';')
    converted = []
    for part in parts:
        prefix = ': ' if part.startswith(': ') else ''
        value = part[len(prefix):]
        if value in LABELS:
            value = LABELS[value]
        else:
            for old, new in [('GRAMS/PELLET','克 / 粒'),('FEET/SECOND','英尺 / 秒'),('ROUNDS','发'),('JOULES','焦耳'),('GRAMS','克'),('RPM','发 / 分钟'),('GAUGE','号口径')]:
                value = value.replace(old, new)
            value = re.sub(r'(?<=\d)\s*KG\b', ' 千克', value)
        converted.append(prefix + value)
    return ';'.join(converted)


def wrap(text, max_width):
    result = []
    for source in text.split(';'):
        line = ''
        for character in source:
            if line and FONT.getlength(line + character) > max_width:
                result.append(line);line = ''
            line += character
        result.append(line)
    return result


def texture(text, x1, y1, x2, y2):
    lines = wrap(text, max(1, (x2-x1)*WIDTH*SCALE-4))
    max_lines = max(1, int((y2-y1)*HEIGHT*SCALE / LINE + .2))
    assert len(lines) <= max_lines, (text, len(lines), max_lines)
    width = max(4, int(max((FONT.getlength(line) for line in lines), default=0))+4)
    height = max(1, len(lines))*LINE
    canvas = Image.new('RGBA', (width, height))
    draw = ImageDraw.Draw(canvas)
    for index, line in enumerate(lines):
        draw.text((2, index*LINE), line, font=FONT, fill=(255,255,255,255), stroke_width=0)
    identity = hashlib.sha256((text+str(width)).encode()).hexdigest()[:20]
    path = 'gfx/winlife-zh/' + identity + '.tga'
    data = io.BytesIO();canvas.save(data, format='TGA', compression='tga_rle')
    images['cstrike/'+path] = data.getvalue()
    return path, min(x2,x1+width/(WIDTH*SCALE)), min(y2,y1+height/(HEIGHT*SCALE))


def localize(source):
    split_names = set()
    def replace(match):
        name, original, command, tail = [match[key] for key in ['name','text','command','tail']]
        x1,y1,x2,y2 = [float(match[key]) for key in ['x1','y1','x2','y2']]
        if original.startswith('YOU HAVE '):
            translated = '可用资金：'
            path, right, bottom = texture(translated,x1,y1,x2,y2)
            split_names.add(name)
            price = original[len('YOU HAVE '):]
            return (f'touch_addbutton "{name}" "{path}" "{command}" {x1:.6f} {y1:.6f} {right:.6f} {bottom:.6f}{tail}\n'
                    f'touch_addbutton "{name}__zhvalue" "#{price}" "{command}" {right+.006:.6f} {y1:.6f} {x2:.6f} {y2:.6f}{tail}')
        translated = translate(original)
        if translated == original or not re.search('[\u3400-\u9fff]',translated):
            return match.group(0)
        translations[original] = translated
        variable_lines = []
        rendered_lines = []
        for index,line in enumerate(translated.split(';')):
            if '$' in line:
                variable_lines.append((index,line));rendered_lines.append('')
            else:
                rendered_lines.append(line)
        rendered = ';'.join(rendered_lines)
        path, right, bottom = texture(rendered,x1,y1,x2,y2)
        result=f'touch_addbutton "{name}" "{path}" "{command}" {x1:.6f} {y1:.6f} {right:.6f} {bottom:.6f}{tail}'
        for index,line in variable_lines:
            split_names.add(name)
            top=y1+index*LINE/(HEIGHT*SCALE)
            result+=f'\ntouch_addbutton "{name}__zhvalue{index}" "#{line}" "{command}" {x1:.6f} {top:.6f} {x2:.6f} {y2:.6f}{tail}'
        return result
    output = []
    for line in source.splitlines():
        output.append(line if line.lstrip().startswith('//') else PATTERN.sub(replace,line))
    text='\n'.join(output)+'\n'
    # When a label contains a dynamic price, its price child must share visibility.
    for name in sorted(split_names,key=len,reverse=True):
        text=re.sub(r'(touch_(?:show|hide|setcolor|setflags|fade)\s+)'+re.escape(name)+r'(?=\s|;|$)',r'\1'+name+'*',text)
    return text


def main():
    files = {}
    for path in sorted(SOURCE.glob('buy*.cfg')):
        original=path.read_text()
        localized=localize(original)
        files['cstrike/touch/'+path.name] = localized.encode()
        # Keep every original actionable button command and its source geometry.
        original_actions=re.findall(r'touch_addbutton\s+"[^"]+"\s+"(?!#)[^"]*"\s+"([^"]+)"',original)
        localized_actions=re.findall(r'touch_addbutton\s+"[^"]+"\s+"(?!#)[^"]*"\s+"([^"]+)"',localized)
        assert original_actions==[action for action in localized_actions if action not in ['_menu_refresh']],path.name
    assert not unknown, sorted(unknown)
    OUTPUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUTPUT,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted({**files,**images}.items()):archive.writestr(name,data)
    report={'menus':len(files),'translatedLabels':len(translations),'textures':len(images),'bytes':OUTPUT.stat().st_size,'sha256':hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),'translations':translations,'fontRendering':'Chinese labels rasterized locally; no font files distributed'}
    (HERE/'shop-zh-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({key:value for key,value in report.items() if key!='translations'},ensure_ascii=False))

if __name__=='__main__':main()
