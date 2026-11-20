import importlib.util,json,hmac,hashlib,unittest
spec=importlib.util.spec_from_file_location('worker','api/whisper.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class WorkerTest(unittest.TestCase):
 def signed(self,source='https://video.xx.fbcdn.net/a.mp4',expires=200):
  body=json.dumps({'source':source,'expires':expires}).encode();return body,hmac.new(b'test',b'dtc-whisper-v1:'+body,hashlib.sha256).hexdigest()
 def test_auth(self):
  body,sig=self.signed();self.assertEqual(worker.verify(body,sig,'test',100)['expires'],200)
  for signature in (None,'bad'):
   with self.assertRaises(ValueError):worker.verify(body,signature,'test',100)
 def test_expiry_and_ssrf(self):
  for url in ('http://video.xx.fbcdn.net/a','https://fbcdn.net.evil.test/a','https://127.0.0.1/a','https://video.xx.fbcdn.net:8080/a'):
   body,sig=self.signed(url)
   with self.assertRaises(ValueError):worker.verify(body,sig,'test',100)
  body,sig=self.signed(expires=99)
  with self.assertRaises(ValueError):worker.verify(body,sig,'test',100)
if __name__=='__main__':unittest.main()
