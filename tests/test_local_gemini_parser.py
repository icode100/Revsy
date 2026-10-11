"""Emulator-only Google launcher, immutable checkpoints and provider page limits."""

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / '.test-deps', ROOT / 'scripts'):
    sys.path.insert(0, str(path))
import httpx
from run_local_gemini_parser import LocalGeminiStore, local_settings
from quiz_gemini.store import MAX_CHECKPOINT_BYTES
from quiz_parser.domain import InvalidImport
from quiz_parser.pipeline import validated_pdf
from quiz_zerogpu.demo import validate_batch


class PageLimitTests(unittest.TestCase):
    def test_large_free_preview_reports_its_actual_limit(self):
        with patch('pypdf.PdfReader', return_value=Mock(is_encrypted=False, pages=range(91))):
            with self.assertRaisesRegex(InvalidImport, '2 pages total'):
                validate_batch([b'%PDF-fixture'])

    def test_paid_legacy_limit_and_google_full_paper_limit_are_distinct(self):
        with patch('pypdf.PdfReader', return_value=Mock(is_encrypted=False, pages=range(91))):
            with self.assertRaisesRegex(InvalidImport, '30 pages'):
                validated_pdf(b'%PDF-fixture')
            self.assertEqual(validated_pdf(b'%PDF-fixture', max_pages=200), 91)

    def test_empty_and_encrypted_files_keep_specific_errors(self):
        for reader, message in ((Mock(is_encrypted=False, pages=[]), 'no pages'),
                                (Mock(is_encrypted=True), 'Password-protected')):
            with patch('pypdf.PdfReader', return_value=reader):
                with self.assertRaisesRegex(InvalidImport, message):
                    validated_pdf(b'%PDF-fixture', max_pages=200)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.job = {'uid': 'local-user', 'id': str(uuid.uuid4()), 'leaseToken': str(uuid.uuid4())}
        self.value = {'schemaVersion': 1, 'model': 'gemini-3.8-flash',
                      'value': {'key': []}, 'usage': {'totalTokenCount': 10}}

    def store(self, handler):
        return LocalGeminiStore(local_settings(), client=httpx.Client(transport=httpx.MockTransport(handler)))

    def test_production_project_cannot_be_selected(self):
        with self.assertRaises(ValueError):
            local_settings('revsy-c66e0', 'revsy-c66e0.firebasestorage.app')

    def test_save_uses_immutable_owned_path_and_updates_pointer_after_upload(self):
        calls, writes = [], []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={})
        store = self.store(handler)
        store.owned_update = lambda job, values: writes.append(values)
        store.save_checkpoint(self.job, 'key', self.value)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].url.host, '127.0.0.1')
        self.assertEqual(calls[0].url.params['ifGenerationMatch'], '0')
        expected = f"users/local-user/quiz-imports/{self.job['id']}/assets/{self.job['leaseToken']}/key-extraction.json"
        self.assertEqual(calls[0].url.params['name'], expected)
        self.assertEqual(writes, [{}, {'keyCheckpointPath': expected}])
        self.assertEqual(self.job['keyCheckpointPath'], expected)
        store.close()

    def test_invalid_name_and_oversized_checkpoint_do_not_write(self):
        store = self.store(lambda _request: self.fail('Unexpected emulator request'))
        with self.assertRaises(InvalidImport):
            store.save_checkpoint(self.job, '../key', self.value)
        with self.assertRaises(InvalidImport):
            store.save_checkpoint(self.job, 'key', {**self.value, 'value': {'text': 'x' * MAX_CHECKPOINT_BYTES}})
        store.close()

    def test_load_pins_metadata_generation_and_rejects_foreign_paths(self):
        path = f"users/local-user/quiz-imports/{self.job['id']}/assets/{self.job['leaseToken']}/key-extraction.json"
        self.job['keyCheckpointPath'] = path
        def handler(request):
            if request.url.params.get('alt') == 'media':
                self.assertEqual(request.url.params.get('generation'), '123')
                return httpx.Response(200, content=json.dumps(self.value))
            return httpx.Response(200, json={'contentType': 'application/json', 'size': '100', 'generation': '123'})
        store = self.store(handler)
        self.assertEqual(store.load_checkpoint(self.job, 'key'), self.value)
        self.job['keyCheckpointPath'] = path.replace('local-user', 'another-user')
        with self.assertRaises(InvalidImport):
            store.load_checkpoint(self.job, 'key')
        store.close()


if __name__ == '__main__':
    unittest.main()
