import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tools.face_restoration import api


class FaceRestorationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(api, 'JOBS_ROOT', Path(self.temp.name))
        self.patch.start()
        api.jobs.clear()
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()
        api.jobs.clear()

    def test_catalog_and_defaults(self):
        data = self.client.get('/face-restoration/models').json()
        self.assertEqual(data['models'][0]['defaults']['fidelity_weight'], .5)
        self.assertEqual(data['models'][0]['defaults']['upscale'], 2)
        self.assertFalse(data['models'][0]['defaults']['face_upsample'])

    def test_reject_invalid_options_and_format(self):
        for settings in [{'model': 'unknown'}, {'fidelity_weight': 2}, {'bg_tile': 0}, {'crf': -1}, {'device': 'shell'}, {'unknown': True}]:
            response = self.client.post('/face-restoration/jobs', files={'file': ('test.png', b'test')}, data={'settings': json.dumps(settings)})
            self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.client.post('/face-restoration/jobs', files={'file': ('a.exe', b'test')}).status_code, 400)

    @patch.object(api, 'execute')
    def test_job_admission_cancel_and_result(self, start):
        response = self.client.post('/face-restoration/jobs', files={'file': ('../../image.png', io.BytesIO(b'input'))})
        self.assertEqual(response.status_code, 200)
        identifier = response.json()['id']
        job = api.jobs[identifier]
        self.assertEqual((job['directory'] / 'source.png').read_bytes(), b'input')
        self.assertNotIn('directory', response.json())
        self.assertEqual(self.client.get(f'/face-restoration/jobs/{identifier}/result').status_code, 409)
        self.assertEqual(self.client.post('/face-restoration/jobs', files={'file': ('a.png', b'input')}).status_code, 409)
        (job['directory'] / 'restored.png').write_bytes(b'output')
        job['phase'] = 'ready'
        self.assertEqual(self.client.get(f'/face-restoration/jobs/{identifier}/result').content, b'output')
        self.assertEqual(self.client.delete(f'/face-restoration/jobs/{identifier}').status_code, 200)
        self.assertFalse(job['directory'].exists())

    def test_empty_upload_is_cleaned(self):
        self.assertEqual(self.client.post('/face-restoration/jobs', files={'file': ('a.png', b'')}).status_code, 400)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_runtime_is_isolated(self):
        self.assertIn('.venv-face-restoration', str(api.PYTHON))
        self.assertEqual(self.client.get('/face-restoration/jobs/missing').status_code, 404)


if __name__ == '__main__':
    unittest.main()
