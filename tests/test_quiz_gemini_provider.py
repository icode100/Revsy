"""Provider protocol, bounds and safe failure handling, entirely mocked."""

import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for directory in (ROOT / '.test-deps', ROOT / 'services/quiz-parser', ROOT / 'services/quiz-gemini'):
    sys.path.insert(0, str(directory))

import httpx
from quiz_parser.domain import InvalidImport
from quiz_gemini.provider import BASE, GeminiClient, response_json


def file_record(name='files/mock-file', state='ACTIVE'):
    return {'name': name, 'uri': BASE + '/v1beta/' + name, 'state': state}


def content_result(value=None, **fields):
    return {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
        {'thought': True, 'text': 'private reasoning'},
        {'text': json.dumps(value if value is not None else {'question': []})}]}}], **fields}


class GeminiResponseTests(unittest.TestCase):
    def test_status_errors_never_expose_upstream_body(self):
        for status in (301, 400, 401, 403, 404, 429, 500, 503):
            with self.subTest(status=status), self.assertRaises(InvalidImport) as error:
                response_json(httpx.Response(status, json={'secret': 'upstream-sensitive-value'}))
            self.assertNotIn('upstream-sensitive-value', str(error.exception))

    def test_response_json_is_bounded_and_requires_object(self):
        self.assertEqual(response_json(httpx.Response(200, json={'ok': True})), {'ok': True})
        for body in (b'bad json', b'\xff', b'[]', b'null', b'1', b'"string"'):
            with self.subTest(body=body), self.assertRaises(InvalidImport):
                response_json(httpx.Response(200, content=body))
        with self.assertRaisesRegex(InvalidImport, 'too much data'):
            response_json(httpx.Response(200, content=b'{' + b' ' * 100 + b'}'), limit=10)


class GeminiClientTests(unittest.TestCase):
    def client(self, handler):
        transport = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(transport.close)
        return GeminiClient('dummy-unit-test-secret', client=transport)

    def test_note_summary_uses_only_text_one_bounded_call_and_private_header(self):
        calls = []
        def respond(request):
            calls.append(request)
            self.assertEqual(request.headers['x-goog-api-key'], 'dummy-unit-test-secret')
            self.assertNotIn('dummy-unit-test-secret', str(request.url))
            self.assertNotIn('dummy-unit-test-secret', request.content.decode())
            payload = json.loads(request.content)
            self.assertEqual(payload['contents'], [{'role': 'user', 'parts': [{'text': 'Find a pair. n <= 1000.'}]}])
            self.assertEqual(payload['generationConfig']['maxOutputTokens'], 2048)
            self.assertEqual(payload['generationConfig']['thinkingConfig'], {'thinkingLevel': 'low'})
            self.assertNotIn('fileData', request.content.decode())
            timeouts = request.extensions['timeout']
            self.assertLessEqual(timeouts['read'] + timeouts['connect'] + timeouts['write'] + timeouts['pool'], 45)
            return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
                {'thought': True, 'text': 'Private reasoning'}, {'text': '  Find two values.\n'}, {'text': 'n <= 1000.  '}]}}]})
        self.assertEqual(self.client(respond).summarize('Find a pair. n <= 1000.'), 'Find two values.\nn <= 1000.')
        self.assertEqual(len(calls), 1)

    def test_note_summary_rejects_incomplete_or_invalid_content(self):
        cases = [
            {}, {'candidates': [{'finishReason': 'MAX_TOKENS', 'content': {'parts': [{'text': 'partial'}]}}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': 1}]}}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'thought': 'true', 'text': 'hidden'}]}}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '  '}]}}]},
        ]
        for result in cases:
            with self.subTest(result=result), self.assertRaises(InvalidImport):
                self.client(lambda request: httpx.Response(200, json=result)).summarize('Problem')

    def test_note_summary_provider_error_is_not_replayed(self):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(429, json={'secret': 'private-upstream-detail'})
        with self.assertRaises(InvalidImport) as error:
            self.client(respond).summarize('Problem')
        self.assertEqual(len(calls), 1)
        self.assertNotIn('private-upstream-detail', str(error.exception))

    def test_configuration_rejects_missing_secrets_and_non_model_paths(self):
        for secret in ('', '  ', None, 42):
            with self.assertRaises(ValueError):
                GeminiClient(secret)
        for model in ('../models/private', 'gemini-x?key=secret', None, '', 'gemini-' + 'a' * 81):
            with self.assertRaises(ValueError):
                GeminiClient('fake', model=model)

    def test_upload_protocol_and_active_reference(self):
        requests = []
        def respond(request):
            requests.append(request)
            if len(requests) == 1:
                self.assertEqual(request.headers['x-goog-upload-command'], 'start')
                self.assertEqual(request.headers['x-goog-upload-header-content-length'], '8')
                return httpx.Response(200, headers={'x-goog-upload-url': BASE + '/upload/v1beta/files?upload_id=mock'})
            self.assertEqual(request.headers['x-goog-upload-command'], 'upload, finalize')
            self.assertEqual(request.content, b'%PDFmock')
            return httpx.Response(200, json={'file': file_record()})
        self.assertEqual(self.client(respond).upload(b'%PDFmock', 'paper'), file_record())
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(request.url.host == 'generativelanguage.googleapis.com' for request in requests))
        self.assertTrue(all(request.headers['x-goog-api-key'] == 'dummy-unit-test-secret' for request in requests))

    def test_upload_rejects_redirect_and_untrusted_or_malformed_endpoint_before_pdf_transfer(self):
        endpoints = ['https://attacker.example/upload/v1beta/files',
            'http://generativelanguage.googleapis.com/upload/v1beta/files',
            'https://user@' + 'generativelanguage.googleapis.com/upload/v1beta/files',
            BASE + ':invalid/upload/v1beta/files', BASE + ':444/upload/v1beta/files',
            BASE + '/v1beta/files', BASE + '/upload/v1beta/files#fragment', '']
        for endpoint in endpoints:
            requests = []
            client = self.client(lambda request: (requests.append(request), httpx.Response(
                200, headers={'x-goog-upload-url': endpoint}))[1])
            with self.subTest(endpoint=endpoint), self.assertRaises(InvalidImport):
                client.upload(b'%PDFmock', 'paper')
            self.assertEqual(len(requests), 1)

    def test_upload_confirmation_must_have_a_valid_file_name(self):
        for file in (None, [], {}, {'name': None}, {'name': 1}, {'name': '../files/other'}):
            calls = []
            def respond(request):
                calls.append(request)
                return httpx.Response(200, headers={'x-goog-upload-url': BASE + '/upload/v1beta/files'}) if len(calls) == 1 else httpx.Response(200, json={'file': file})
            with self.subTest(file=file), self.assertRaises(InvalidImport):
                self.client(respond).upload(b'%PDFmock', 'paper')

    def test_processing_poll_keeps_exact_file_identity_and_cleans_up_original_file(self):
        for polled in (file_record('files/other'), {'state': 'ACTIVE'},
                       {**file_record(), 'uri': 'https://attacker.example/pdf'}):
            calls = []
            def respond(request):
                calls.append(request)
                if len(calls) == 1:
                    return httpx.Response(200, headers={'x-goog-upload-url': BASE + '/upload/v1beta/files'})
                if len(calls) == 2:
                    return httpx.Response(200, json={'file': file_record(state='PROCESSING')})
                if request.method == 'GET':
                    return httpx.Response(200, json=polled)
                return httpx.Response(200, json={})
            with self.subTest(polled=polled), patch('quiz_gemini.provider.time.sleep'), self.assertRaises(InvalidImport):
                self.client(respond).upload(b'%PDFmock', 'paper')
            self.assertEqual(calls[-1].method, 'DELETE')
            self.assertEqual(calls[-1].url.path, '/v1beta/files/mock-file')
            self.assertFalse(any('/other' in request.url.path for request in calls))

    def test_processing_can_complete_with_bounded_polling(self):
        calls = []
        def respond(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(200, headers={'x-goog-upload-url': BASE + '/upload/v1beta/files'})
            if len(calls) == 2:
                return httpx.Response(200, json={'file': file_record(state='PROCESSING')})
            return httpx.Response(200, json=file_record())
        with patch('quiz_gemini.provider.time.sleep'):
            self.assertEqual(self.client(respond).upload(b'%PDFmock', 'paper'), file_record())
        self.assertEqual(len(calls), 3)

    def test_upload_network_errors_are_safe_and_are_not_replayed(self):
        calls = []
        def fail(request):
            calls.append(request)
            raise httpx.ReadTimeout('url contained private upload_id and dummy-unit-test-secret', request=request)
        with self.assertRaises(InvalidImport) as error:
            self.client(fail).upload(b'%PDFmock', 'paper')
        self.assertEqual(len(calls), 1)
        self.assertNotIn('dummy-unit-test-secret', str(error.exception))
        self.assertNotIn('upload_id', str(error.exception))

    def test_extract_uses_structured_pdf_request_and_filters_usage_metadata(self):
        requests = []
        def respond(request):
            requests.append(request)
            body = json.loads(request.content)
            self.assertEqual(body['contents'][0]['parts'][0]['fileData']['fileUri'], file_record()['uri'])
            self.assertEqual(body['generationConfig']['maxOutputTokens'], 16384)
            self.assertEqual(body['generationConfig']['responseJsonSchema'], {'type': 'object'})
            self.assertEqual(body['generationConfig']['thinkingConfig'], {'thinkingLevel': 'low'})
            self.assertNotIn('temperature', body['generationConfig'])
            return httpx.Response(200, json=content_result({'key': []}, usageMetadata={
                'promptTokenCount': 10, 'candidatesTokenCount': 20, 'totalTokenCount': 30,
                'thoughtsTokenCount': -1, 'extraSecret': 'hidden', 'cachedContentTokenCount': 7}))
        extracted, usage = self.client(respond).extract(file_record(), 'transcribe', {'type': 'object'}, output_tokens=16384)
        self.assertEqual(extracted, {'key': []})
        self.assertEqual(usage, {'promptTokenCount': 10, 'candidatesTokenCount': 20, 'totalTokenCount': 30})
        self.assertEqual(len(requests), 1)

    def test_older_gemini_retains_zero_temperature_without_unsupported_thinking_level(self):
        def respond(request):
            generation = json.loads(request.content)['generationConfig']
            self.assertEqual(generation['temperature'], 0)
            self.assertNotIn('thinkingConfig', generation)
            return httpx.Response(200, json=content_result({}))
        client = self.client(respond)
        client.model = 'gemini-2.5-flash'
        self.assertEqual(client.extract(file_record(), 'prompt', {})[0], {})

    def test_extract_rejects_truncation_blocks_and_malformed_provider_shapes_safely(self):
        values = [ {}, {'candidates': None}, {'candidates': {}}, {'candidates': ['bad']},
            {'candidates': [{'finishReason': 'MAX_TOKENS'}]},
            {'candidates': [{'finishReason': 'SAFETY'}]},
            {'candidates': [{'finishReason': 'STOP', 'content': None}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': None}}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': ['bad']}}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': None}]}}]},
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{}', 'thought': 'false'}]}}]},
            content_result([], usageMetadata={}), content_result({}, usageMetadata=None),
            content_result({}, usageMetadata=[]),
            {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{"partial":'}]}}]},
        ]
        for result in values:
            with self.subTest(result=result), self.assertRaises(InvalidImport):
                self.client(lambda request: httpx.Response(200, json=result)).extract(file_record(), 'prompt', {})

    def test_inference_connection_failure_has_no_automatic_paid_replay(self):
        calls = []
        def fail(request):
            calls.append(request)
            raise httpx.ReadTimeout('private key dummy-unit-test-secret', request=request)
        with self.assertRaises(InvalidImport) as error:
            self.client(fail).extract(file_record(), 'prompt', {})
        self.assertEqual(len(calls), 1)
        self.assertNotIn('dummy-unit-test-secret', str(error.exception))

    def test_delete_never_targets_invalid_file_names_and_tolerates_network_failure(self):
        calls = []
        client = self.client(lambda request: (calls.append(request), httpx.Response(204))[1])
        for value in (None, {}, {'name': None}, {'name': 'files/../other'}, {'name': 'https://attacker.example/file'}):
            client.delete(value)
        self.assertEqual(calls, [])
        client.delete(file_record())
        self.assertEqual(len(calls), 1)
        broken = self.client(lambda request: (_ for _ in ()).throw(httpx.ConnectError('sensitive URL', request=request)))
        broken.delete(file_record())

    def test_expired_budget_stops_paid_request_and_skips_network_cleanup(self):
        clock = [100.0]
        calls = []
        client = self.client(lambda request: (calls.append(request), httpx.Response(200, json=content_result({})))[1])
        with patch('quiz_gemini.provider.time.monotonic', side_effect=lambda: clock[0]):
            with client.processing_budget(10):
                clock[0] = 110.0
                for action in (lambda: client.upload(b'%PDFmock', 'paper'),
                               lambda: client.extract(file_record(), 'prompt', {})):
                    with self.assertRaisesRegex(InvalidImport, 'time limit'):
                        action()
                client.delete(file_record())
            client.check_budget()
        self.assertEqual(calls, [])

    def test_remaining_budget_bounds_each_network_phase_without_extending_nested_budget(self):
        clock = [100.0]
        timeouts = []
        def respond(request):
            timeouts.append(request.extensions['timeout'])
            return httpx.Response(200, json=content_result({}))
        client = self.client(respond)
        with patch('quiz_gemini.provider.time.monotonic', side_effect=lambda: clock[0]):
            with client.processing_budget(60):
                clock[0] = 145.0
                with client.processing_budget(120):
                    client.extract(file_record(), 'prompt', {})
                    self.assertLessEqual(sum(timeouts[-1].values()), 15.0)
                    self.assertTrue(all(0 < value <= 15 for value in timeouts[-1].values()))
                    clock[0] = 160.0
                    with self.assertRaisesRegex(InvalidImport, 'time limit'):
                        client.check_budget()
            self.assertEqual(client.extract(file_record(), 'prompt', {})[0], {})

    def test_budget_contexts_are_isolated_between_worker_threads(self):
        client = self.client(lambda request: httpx.Response(200, json=content_result({})))
        clock = [100.0]
        started = threading.Event()
        finish = threading.Event()
        errors = []
        def background():
            try:
                with client.processing_budget(1):
                    started.set()
                    finish.wait(timeout=2)
                    with self.assertRaisesRegex(InvalidImport, 'time limit'):
                        client.check_budget()
            except BaseException as error:
                errors.append(error)
        with patch('quiz_gemini.provider.time.monotonic', side_effect=lambda: clock[0]):
            thread = threading.Thread(target=background)
            thread.start()
            try:
                self.assertTrue(started.wait(timeout=2))
                clock[0] = 102.0
                client.check_budget()
                self.assertEqual(client.extract(file_record(), 'prompt', {})[0], {})
            finally:
                finish.set()
                thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])

    def test_poll_sleep_is_capped_and_expiry_stops_follow_up_request(self):
        clock = [100.0]
        calls, sleeps = [], []
        def respond(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(200, headers={'x-goog-upload-url': BASE + '/upload/v1beta/files'})
            clock[0] = 109.5
            return httpx.Response(200, json={'file': file_record(state='PROCESSING')})
        def sleep(seconds):
            sleeps.append(seconds)
            clock[0] += seconds
        client = self.client(respond)
        with patch('quiz_gemini.provider.time.monotonic', side_effect=lambda: clock[0]), patch(
                'quiz_gemini.provider.time.sleep', side_effect=sleep):
            with client.processing_budget(10), self.assertRaisesRegex(InvalidImport, 'time limit'):
                client.upload(b'%PDFmock', 'paper')
        self.assertEqual(sleeps, [0.5])
        self.assertEqual(len(calls), 2)
        self.assertFalse(any(request.method in {'GET', 'DELETE'} for request in calls))

    def test_streamed_json_checks_deadline_between_chunks(self):
        clock = [100.0]
        client = self.client(lambda request: httpx.Response(200, json={}))
        class Response:
            status_code = 200
            def iter_bytes(self):
                yield b'{'
                clock[0] = 111.0
                yield b'}'
        with patch('quiz_gemini.provider.time.monotonic', side_effect=lambda: clock[0]):
            with client.processing_budget(10), self.assertRaisesRegex(InvalidImport, 'time limit'):
                response_json(Response(), check_budget=client.check_budget)

    def test_invalid_budget_values_cannot_disable_or_extend_deadline(self):
        client = self.client(lambda request: httpx.Response(200, json={}))
        for seconds in (0, -1, True, None, '10', float('nan'), float('inf'), 1681):
            with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                with client.processing_budget(seconds):
                    pass


if __name__ == '__main__':
    unittest.main()
