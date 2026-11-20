"""Private, signed speech worker. Invoked only by the authenticated Node API."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import tempfile
import re
import traceback
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

_model = None
_lock = threading.Lock()
MAX_BYTES = 32 * 1024 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def verify(body, signature, secret, now=None):
    if not secret or not signature or not hmac.compare_digest(hmac.new(secret.encode(), b'dtc-whisper-v1:'+body, hashlib.sha256).hexdigest(), signature):
        raise ValueError('unauthorized')
    data = json.loads(body)
    now = time.time() if now is None else now
    if not now <= data.get('expires', 0) <= now + 310:
        raise ValueError('expired')
    u = urlparse(data.get('source', ''))
    if u.scheme != 'https' or u.username or u.password or u.port not in (None,443) or not any((u.hostname or '').endswith(s) for s in ('.fbcdn.net','.cdninstagram.com','.private.blob.vercel-storage.com')):
        raise ValueError('invalid_media_url')
    return data

def transcribe_file(path):
    global _model
    from faster_whisper import WhisperModel
    import av
    with av.open(path) as container:
        if not container.streams.audio:
            return {'transcript':'','segments':[],'language':None,'duration':0,'provider':'faster-whisper','model':'small','no_speech':True}
        if container.duration is None or container.duration / 1000000 > 300:
            raise ValueError('video_too_long')
    if _model is None:
        bundled=Path(__file__).resolve().parent.parent/'services'/'transcription'/'model'
        _model = WhisperModel(str(bundled) if bundled.exists() else 'small', device='cpu', compute_type='int8', cpu_threads=2, num_workers=1, download_root='/tmp/whisper-models',local_files_only=bundled.exists())
    segments, info = _model.transcribe(path, beam_size=3, vad_filter=True, condition_on_previous_text=False)
    rows = [{'start':round(s.start,3),'end':round(s.end,3),'text':s.text.strip()} for s in segments if s.text.strip()]
    return {'transcript':'\n'.join(s['text'] for s in rows),'segments':rows,'language':info.language,'duration':round(info.duration,3),'provider':'faster-whisper','model':'small','no_speech':not rows}

class handler(BaseHTTPRequestHandler):
    def reply(self, code, result):
        body=json.dumps(result,ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<=0 or length>16384:
                return self.reply(400,{'error':'invalid_request'})
            body=self.rfile.read(length)
            try:
                data=verify(body,self.headers.get('X-Whisper-Signature'),os.environ.get('DASH_SESSION_SECRET',''))
            except (ValueError,TypeError,KeyError):
                return self.reply(403,{'error':'unauthorized'})
            if not _lock.acquire(blocking=False):
                return self.reply(409,{'error':'transcription_busy'})
            try:
                opener=urllib.request.build_opener(NoRedirect)
                with opener.open(data['source'],timeout=25) as response, tempfile.NamedTemporaryFile(suffix='.mp4') as video:
                    if response.headers.get_content_type()!='video/mp4':
                        raise ValueError('media_unavailable')
                    size=0
                    while True:
                        block=response.read(1024*1024)
                        if not block: break
                        size+=len(block)
                        if size>MAX_BYTES: raise ValueError('media_too_large')
                        video.write(block)
                    video.flush()
                    result=transcribe_file(video.name)
                self.reply(200,result)
            finally:
                _lock.release()
        except ValueError as exc:
            self.reply(422,{'error':str(exc) if str(exc) in ('video_too_long','media_too_large','media_unavailable') else 'transcription_failed'})
        except Exception as exc:
            print('whisper_error',type(exc).__name__,re.sub(r'https?://\S+', '[url]', str(exc))[:350],[(Path(f.filename).name,f.lineno) for f in traceback.extract_tb(exc.__traceback__)][-5:],flush=True)
            self.reply(503,{'error':'transcription_failed'})
    def do_GET(self):
        self.reply(405,{'error':'method_not_allowed'})
