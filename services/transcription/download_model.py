"""Pin and bundle the public Whisper model at build time, never in /tmp at runtime."""
from pathlib import Path
import shutil
import urllib.request
REVISION='536b0662742c02347bc0e980a01041f333bce120'
root=Path(__file__).parent/'model'
root.mkdir(parents=True,exist_ok=True)
for name in ('config.json','tokenizer.json','vocabulary.txt','model.bin'):
    target=root/name
    if target.exists() and target.stat().st_size>0: continue
    url=f'https://huggingface.co/Systran/faster-whisper-small/resolve/{REVISION}/{name}'
    temporary=target.with_suffix('.download')
    with urllib.request.urlopen(url,timeout=120) as source,temporary.open('wb') as output:
        shutil.copyfileobj(source,output)
    temporary.replace(target)
    print('Bundled Whisper asset:',name,flush=True)
