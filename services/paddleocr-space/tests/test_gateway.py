import asyncio
import base64
import json
import unittest
from unittest.mock import patch

import httpx

from app import create_app, NATIVE_COMMAND, Settings

TOKEN = "test-only-shared-secret-with-more-than-32-chars"
BUCKET = "demo.firebasestorage.app"
PDF = base64.b64encode(b"%PDF-1.7\nsmall fixture\n%%EOF").decode("ascii")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
SOURCE = f"https://storage.googleapis.com/{BUCKET}/users/user1/quiz-imports/import1/paper.pdf?X-Goog-Signature=test"
RESULT = {"errorCode": 0, "result": {"layoutParsingResults": [{"markdown": {"text": "Question $x^2$"}}]}}


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.forwarded = []
        self.ready = True
        self.active = 0
        self.maximum_active = 0
        self.native_delay = 0
        self.reply = httpx.Response(200, json=RESULT)
        self.source_requests = []
        self.source_reply = httpx.Response(200, content=base64.b64decode(PDF))

        async def native(request):
            if request.url.path == "/openapi.json":
                return httpx.Response(200 if self.ready else 503, json={"openapi": "3.1.0"})
            self.assertEqual(request.url.path, "/layout-parsing")
            self.assertNotIn("authorization", request.headers)
            self.forwarded.append(json.loads(request.content))
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
            try:
                await asyncio.sleep(self.native_delay)
                return self.reply
            finally:
                self.active -= 1

        async def source(request):
            self.assertNotIn("authorization", request.headers)
            self.source_requests.append(str(request.url))
            return self.source_reply

        self.application = create_app(Settings(TOKEN, BUCKET), transport=httpx.MockTransport(native), source_transport=httpx.MockTransport(source), launch_native=False)
        self.lifespan = self.application.router.lifespan_context(self.application)
        await self.lifespan.__aenter__()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.application), base_url="http://space.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.lifespan.__aexit__(None, None, None)

    async def post(self, payload=None, **kwargs):
        return await self.client.post("/layout-parsing", json=payload or {"file": PDF, "fileType": 0}, headers=HEADERS, **kwargs)

    async def test_authentication_precedes_body_parsing(self):
        for headers in ({}, {"Authorization": "Bearer wrong-token"}):
            response = await self.client.post("/layout-parsing", content=b"not json", headers=headers)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(self.forwarded, [])
            self.assertNotIn(TOKEN, response.text)

    async def test_base64_pdf_and_worker_options_round_trip(self):
        payload = {"file": PDF, "fileType": 0, "useLayoutDetection": True,
                   "useChartRecognition": False, "formatBlockContent": True,
                   "returnMarkdownImages": True, "visualize": False, "prettifyMarkdown": False,
                   "useDocOrientationClassify": False, "useDocUnwarping": False}
        response = await self.post(payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), RESULT)
        self.assertEqual(self.forwarded, [payload])
        self.assertEqual(response.headers["cache-control"], "no-store")

    async def test_owned_bucket_urls_are_resolved_into_pdf_without_source_credentials(self):
        sources = [SOURCE,
                   SOURCE.replace("user1", "custom.user:1"),
                   f"https://{BUCKET}.storage.googleapis.com/users/user1/quiz-imports/import1/answer-key.pdf?signature=test",
                   f"https://firebasestorage.googleapis.com/v0/b/{BUCKET}/o/users%2Fuser1%2Fquiz-imports%2Fimport1%2Fpaper.pdf?alt=media&token=test"]
        for source in sources:
            with self.subTest(source=source):
                response = await self.post({"file": source, "fileType": 0})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.source_requests[-1], source)
                self.assertEqual(self.forwarded[-1]["file"], PDF)

    async def test_non_owned_and_unsafe_urls_never_reach_pipeline(self):
        for source in ["http://127.0.0.1/internal.pdf", "https://example.com/paper.pdf",
                       SOURCE.replace(BUCKET, "other-bucket"), SOURCE.replace("https://", "https://user:password@"),
                       SOURCE + "#fragment", SOURCE.replace("storage.googleapis.com", "storage.googleapis.com.evil.test"),
                       SOURCE.replace("/users/user1/", "/users/../"), SOURCE.replace("/paper.pdf", "/asset.png")]:
            with self.subTest(source=source):
                response = await self.post({"file": source, "fileType": 0})
                self.assertEqual(response.status_code, 400)
                self.assertNotIn(source, response.text)
        self.assertEqual(self.forwarded, [])

    async def test_payload_types_and_pdf_header_are_validated(self):
        payloads = [{"file": PDF, "fileType": 1}, {"file": PDF, "fileType": False},
                    {"file": "!invalid base64!", "fileType": 0},
                    {"file": base64.b64encode(b"not a PDF").decode(), "fileType": 0},
                    {"file": PDF, "fileType": 0, "useLayoutDetection": "true"},
                    {"file": PDF, "fileType": 0, "pipeline": "/tmp/override.yaml"}, []]
        for payload in payloads:
            with self.subTest(payload=payload):
                response = await self.client.post("/layout-parsing", json=payload, headers=HEADERS)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.forwarded, [])

    async def test_json_and_content_type_failures_are_sanitized(self):
        for body in [b"{", b'{"fileType":0,"fileType":1}', b'{"file":NaN,"fileType":0}']:
            response = await self.client.post("/layout-parsing", content=body, headers={**HEADERS, "Content-Type": "application/json"})
            self.assertEqual(response.status_code, 400)
        response = await self.client.post("/layout-parsing", content=b"{}", headers=HEADERS)
        self.assertEqual(response.status_code, 415)
        response = await self.client.post("/layout-parsing", content=b"{}", headers={**HEADERS, "Content-Type": "application/json", "Content-Encoding": "gzip"})
        self.assertEqual(response.status_code, 415)

    async def test_declared_and_streamed_request_sizes_are_bounded(self):
        with patch("app.MAX_REQUEST_BYTES", 32):
            response = await self.post()
            self.assertEqual(response.status_code, 413)
            async def chunks():
                yield b"x" * 20
                yield b"x" * 20
            response = await self.client.post("/layout-parsing", content=chunks(), headers={**HEADERS, "Content-Type": "application/json"})
            self.assertEqual(response.status_code, 413)
        self.assertEqual(self.forwarded, [])

    async def test_decoded_pdf_size_is_bounded(self):
        with patch("app.MAX_PDF_BYTES", 8):
            response = await self.post()
            self.assertEqual(response.status_code, 413)
        self.assertEqual(self.forwarded, [])

    async def test_signed_url_pdf_size_and_redirects_are_bounded(self):
        with patch("app.MAX_PDF_BYTES", 8):
            self.assertEqual((await self.post({"file": SOURCE, "fileType": 0})).status_code, 413)
        self.source_reply = httpx.Response(302, headers={"Location": "http://127.0.0.1/internal"})
        self.assertEqual((await self.post({"file": SOURCE, "fileType": 0})).status_code, 502)
        self.assertEqual(len(self.source_requests), 2)
        self.assertEqual(self.forwarded, [])

    async def test_upstream_error_body_is_never_exposed(self):
        self.reply = httpx.Response(500, text=SOURCE + TOKEN)
        response = await self.post()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(SOURCE, response.text)
        self.assertNotIn(TOKEN, response.text)

    async def test_invalid_success_and_oversized_responses_are_rejected(self):
        for reply in [httpx.Response(200, text="not json"), httpx.Response(200, json=[]),
                      httpx.Response(200, json={"errorCode": 500, "errorMsg": SOURCE})]:
            self.reply = reply
            response = await self.post()
            self.assertEqual(response.status_code, 502)
            self.assertNotIn(SOURCE, response.text)
        self.reply = httpx.Response(200, json=RESULT)
        with patch("app.MAX_RESPONSE_BYTES", 8):
            response = await self.post()
            self.assertEqual(response.status_code, 502)

    async def test_requests_are_serialized(self):
        self.native_delay = 0.02
        responses = await asyncio.gather(self.post(), self.post(), self.post())
        self.assertEqual([response.status_code for response in responses], [200, 200, 200])
        self.assertEqual(self.maximum_active, 1)

    async def test_busy_model_returns_retryable_status(self):
        await self.application.state.model_lock.acquire()
        try:
            with patch("app.QUEUE_WAIT_SECONDS", 0.01):
                response = await self.post()
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.headers["retry-after"], "10")
        finally:
            self.application.state.model_lock.release()
        self.assertEqual(self.forwarded, [])

    async def test_health_reflects_native_readiness(self):
        self.assertEqual((await self.client.get("/health")).json()["status"], "ready")
        self.ready = False
        response = await self.client.get("/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "model_starting")
        self.assertEqual((await self.post()).status_code, 503)
        self.assertEqual((await self.client.get("/docs")).status_code, 404)

    async def test_configuration_required_fails_closed(self):
        self.application.state.settings = Settings("", BUCKET)
        self.assertEqual((await self.client.get("/health")).json()["status"], "configuration_required")
        self.assertEqual((await self.post()).status_code, 503)
        self.assertEqual(self.forwarded, [])

    async def test_timeout_stops_accepting_more_native_inference(self):
        self.native_delay = 0.05
        with patch("app.MODEL_TIMEOUT_SECONDS", 0.01):
            self.assertEqual((await self.post()).status_code, 504)
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "model_failed")
        self.assertEqual((await self.post()).status_code, 503)

    async def test_cancelled_native_request_fails_closed(self):
        self.native_delay = 0.1
        request = asyncio.create_task(self.post())
        while not self.forwarded:
            await asyncio.sleep(0.001)
        request.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request
        self.assertEqual((await self.client.get("/health")).json()["status"], "model_failed")
        self.assertEqual((await self.post()).status_code, 503)

    def test_native_pipeline_is_full_v1_6_and_loopback_only(self):
        self.assertIn("PaddleOCR-VL-1.6", NATIVE_COMMAND)
        self.assertIn("127.0.0.1", NATIVE_COMMAND)
        self.assertIn("gpu:0", NATIVE_COMMAND)


if __name__ == "__main__":
    unittest.main()
