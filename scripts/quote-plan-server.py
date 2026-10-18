"""Local-only floor plan text recognition. Run: python3 scripts/quote-plan-server.py."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json, re, subprocess, tempfile, threading, os
ROOT = Path(__file__).resolve().parents[1]
BIN = Path(tempfile.gettempdir()) / 'houzy-plan-ocr'
LOCK = threading.Lock()
LABELS = [
 ('dryKitchen',r'dry\s*kitchen|干厨'),('wetKitchen',r'wet\s*kitchen|湿厨'),
 ('porch',r'car\s*porch|carport|车廊|车库'),('backyard',r'back\s*yard|rear\s*yard|后院'),('yard',r'side\s*yard|garden|侧院|花园'),
 ('master',r'master(?:\s*(?:bed\s*room|bedroom|bed))?|主卧'),('family',r'family\s*(?:hall|area|room)|家庭厅|起居厅'),
 ('dining',r'dining(?:\s*(?:room|area))?|餐厅'),('living',r'living(?:\s*(?:room|area))?|客厅'),
 ('bedroom',r'bed\s*room\s*\d*|bedroom\s*\d*|卧室\s*\d*|客房'),
 ('bath',r'bath(?:room)?\s*\d*|toilet\s*\d*|w\.?c\.?|卫生间|浴室|主卫|公卫'),
 ('kitchen',r'kitchen|厨房'),('laundry',r'laundry|utility|洗衣区|洗衣房'),
 ('balcony',r'balcony|阳台'),('study',r'study(?:\s*room)?|书房'),('store',r'stor(?:e|age)(?:\s*room)?|储物间|储藏室'),
 ('foyer',r'foyer|entrance\s*hall|玄关'),('stairs',r'stair(?:case|s)?|楼梯'),('corridor',r'corridor|passage|走廊|过道')]
def parse(lines):
    rooms=[]
    ignored=set()
    for page in {x['page'] for x in lines}:
        text='\n'.join(x['text'] for x in lines if x['page']==page)
        floor_plan=re.search(r'\b(?:ground|first|second|third|\d+(?:st|nd|rd|th))\s+floor\s+plan\b|平面图',text,re.I)
        if not floor_plan and re.search(r'\b(?:section|elevation)\b|剖面图|立面图',text,re.I): ignored.add(page)
    for line in lines:
        if line['page'] in ignored: continue
        text=line['text'].strip()
        if len(text)>100: continue
        # CamScanner/Vision often places the room number on the next OCR line
        # (for example "Bath" followed by a separate "4"). Join a nearby
        # single digit so the imported name remains distinguishable.
        page_lines=[x for x in lines if x['page']==line['page']]
        label_text=text
        if not re.search(r'\d', label_text):
            nearby=[]
            for x in page_lines:
                if x is line: continue
                candidate=x['text'].strip()
                if re.fullmatch(r'[1-9]', candidate):
                    dy=abs(float(x.get('y', 0))-float(line.get('y', 0)))
                    dx=abs(float(x.get('x', 0))-float(line.get('x', 0)))
                    if dy <= 0.06 and dx <= 0.16: nearby.append((dy+dx, candidate))
            if nearby: label_text=f'{label_text} {min(nearby)[1]}'
        kind=next((k for k,pat in LABELS if re.search(r'(?<![A-Za-z])(?:'+pat+r')(?![A-Za-z])',label_text,re.I)),None)
        if not kind: continue
        floor_titles = []
        names = [(1, r'ground|g'), (2, r'first|1st'), (3, r'second|2nd'), (4, r'third|3rd')]
        for x in page_lines:
            title=x['text'].strip()
            for value, pattern in names:
                if re.fullmatch(r'(?:'+pattern+r')\s+(?:floor|flr\.?)\s*(?:plan)?', title, re.I):
                    floor_titles.append((value,title))
            if title in ('底层平面图','首层平面图'): floor_titles.append((1,title))
        levels={x[0] for x in floor_titles}
        level=next(iter(levels)) if len(levels)==1 else None
        level_evidence=' / '.join(dict.fromkeys(x[1] for x in floor_titles))
        # Only dimensions explicitly attached to the room label; no guessing by proximity/scale.
        dim=re.search(r'(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|尺|英尺|米|毫米)?\s*[x×X]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|尺|英尺|米|毫米)\b',text,re.I)
        L=W=None
        if dim:
            unit=dim[4].lower(); unit1=(dim[2] or unit).lower()
            scale={'mm':1/304.8,'毫米':1/304.8,'cm':1/30.48,'m':1/0.3048,'米':1/0.3048,'ft':1,'feet':1,'尺':1,'英尺':1}
            if unit1 in scale and unit in scale:
                L=round(float(dim[1])*scale[unit1],3); W=round(float(dim[3])*scale[unit],3)
        display_name=label_text
        if kind == 'master' and not re.search(r'bed', display_name, re.I): display_name='Master Bedroom'
        if kind == 'bath' and display_name.lower() == 'bath': display_name='Bathroom（图纸未编号）'
        if kind == 'bedroom' and display_name.lower() == 'bedroom': display_name='Bedroom（图纸未编号）'
        rooms.append(dict(type=kind,name=display_name,L=L,W=W,H=None,level=level,levelEvidence=level_evidence,page=line['page'],evidence=text,planName=display_name,warning='请核对房间边界、楼层和尺寸；未识别数据留空。'))
    # If the drawing has repeated labels without readable numbers, give each
    # candidate a stable ordinal so the review screen never shows five
    # indistinguishable "Bedroom" rows.
    unknown_counts = {}
    for room in rooms:
        if '图纸未编号' not in room['name']: continue
        key = (room['page'], room['type'])
        unknown_counts[key] = unknown_counts.get(key, 0) + 1
        ordinal = unknown_counts[key]
        room['name'] = room['name'].replace('（图纸未编号）', f'（图纸未编号·第 {ordinal} 个）')
        room['planName'] = room['name']
    return dict(ignoredPages=sorted(ignored),rooms=rooms,engine='本地文字识别',warnings=([f'第 {p} 页为立面/剖面图，不重复生成房间。' for p in sorted(ignored)]+['仅识别文字标签与同一标签行明确标注的长×宽及单位，不识别墙线、比例尺、门窗或施工点位。','重复标签若编号未读出，会以“图纸未编号·第 N 个”区分，需在核对页按图纸改名。']),text='\n'.join(f"P{x['page']}: {x['text']}" for x in lines))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def end_headers(self):
        origin=self.headers.get('Origin','')
        if origin in ('null','http://127.0.0.1:8766','http://localhost:8766'):
            self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def reply(self,status,obj):
        data=json.dumps(obj,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path.split('?')[0] not in ('/', '/portal/quote.html'):
            return self.reply(404, {'error':'Not found'})
        self.path='/portal/quote.html'
        return super().do_GET()
    def do_OPTIONS(self):
        self.send_response(204);self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type, X-Plan-Type');self.end_headers()
    def do_POST(self):
        if self.path!='/analyze':return self.reply(404,{'error':'Not found'})
        if self.headers.get('Origin','') not in ('','null','http://127.0.0.1:8766','http://localhost:8766'):return self.reply(403,{'error':'Origin not allowed'})
        try:size=int(self.headers.get('Content-Length','0'))
        except ValueError:return self.reply(400,{'error':'无效文件长度'})
        if not 0<size<=20*1024*1024:return self.reply(413,{'error':'请选择不超过 20 MB 的文件'})
        ext=self.headers.get('X-Plan-Type','').lower()
        if ext not in ('pdf','png','jpg','jpeg','webp'):return self.reply(400,{'error':'支持 PDF、PNG、JPG、WebP'})
        if not LOCK.acquire(blocking=False):return self.reply(429,{'error':'正在分析另一张图，请稍后重试'})
        try:
            with tempfile.TemporaryDirectory(prefix='houzy-plan-') as tmp:
                p=Path(tmp)/('plan.'+ext);p.write_bytes(self.rfile.read(size))
                proc=subprocess.run([str(BIN),str(p)],capture_output=True,text=True,timeout=100)
                if proc.returncode:raise ValueError('无法识别此文件。PDF 最多 12 页，请检查文件是否损坏或加密。')
                self.reply(200,parse(json.loads(proc.stdout)))
        except subprocess.TimeoutExpired:self.reply(408,{'error':'识别超时，请拆分 PDF 或缩小图片后重试。'})
        except Exception as exc:self.reply(422,{'error':str(exc)})
        finally:LOCK.release()
if __name__=='__main__':
    swift=ROOT/'scripts/plan-ocr.swift'
    if not BIN.exists() or BIN.stat().st_mtime<swift.stat().st_mtime:
        subprocess.run(['swiftc',str(swift),'-o',str(BIN)],check=True)
    print('报价器及本地识别：http://127.0.0.1:8766/portal/quote.html',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8766),Handler).serve_forever()
