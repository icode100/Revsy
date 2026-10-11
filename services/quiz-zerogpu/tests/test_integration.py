import base64
import io
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from pypdf import PdfWriter

from quiz_parser.domain import InvalidImport, LeaseLost
from quiz_zerogpu.integration import FreeModels, FreeWorker, checked_space_url, parse_free_job


JOB_ID = "47f0efda-5988-4f7b-8b11-ab333191bd09"
PREFIX = f"users/alice/quiz-imports/{JOB_ID}/"
PAPER_TEXT = "1. Find $x^2$ for $x=2$.\n(A) $2$\n(B) $4$"
KEY_TEXT = "1 B"


def pdf(count=1):
    writer, output = PdfWriter(), io.BytesIO()
    for _ in range(count):
        writer.add_blank_page(width=144, height=144)
    writer.write(output)
    return output.getvalue()


def page(text=PAPER_TEXT):
    return {"markdown": {"text": text, "images": {}},
            "prunedResult": {"width": 144, "height": 144, "parsing_res_list": []}}


def job(separate=True):
    result = {"uid": "alice", "id": JOB_ID, "title": "Math quiz", "leaseToken": "lease",
              "paperPath": PREFIX + "paper.pdf"}
    if separate:
        result["answerKeyPath"] = PREFIX + "answer-key.pdf"
    return result


def models(result=None, error=None):
    settings = SimpleNamespace(paddle_url="https://icode100-revsy-quiz-zerogpu.hf.space",
                               paddle_token="server-secret", hf_token="owner-token", lease_seconds=180)
    queued = Mock()
    queued.result.return_value = result if result is not None else [[page()]]
    if error:
        queued.result.side_effect = error
    client = Mock()
    client.submit.return_value = queued
    factory = Mock(return_value=client)
    return FreeModels(settings, client_factory=factory), factory, client, queued


class Store:
    def __init__(self, documents):
        self.documents, self.loads, self.updates, self.images = documents, [], [], {}
        self.settings = SimpleNamespace(lease_seconds=180)

    def load_pdf(self, path):
        self.loads.append(path)
        return self.documents[path], object()

    def owned_update(self, import_job, fields, *, terminal=False):
        self.updates.append((fields, terminal))

    def save_image(self, import_job, asset_id, content, number):
        path = PREFIX + "assets/lease/" + asset_id + ".png"
        self.images[path] = content
        return {"id": asset_id, "storagePath": path, "page": number}


class IntegrationTests(unittest.TestCase):
    def test_only_exact_canonical_https_space_hosts_are_allowed(self):
        self.assertEqual(checked_space_url("https://icode100-revsy-quiz-zerogpu.hf.space/"),
                         "https://icode100-revsy-quiz-zerogpu.hf.space")
        for value in ("http://example.hf.space", "https://localhost", "https://example.hf.space.attacker.com",
                      "https://user:secret@example.hf.space", "https://example.hf.space/path",
                      "https://example.hf.space?token=x", "https://example.hf.space#fragment",
                      "https://example.hf.space:8080", "https://example.hf.space:bad"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                checked_space_url(value)

    def test_owner_token_and_shared_secret_use_one_bounded_batch_event(self):
        model, factory, client, queued = models([[page()], [page(KEY_TEXT)]])
        documents = [pdf(), pdf()]
        result = model.ocr_documents(documents)
        self.assertEqual(len(result), 2)
        factory.assert_called_once()
        self.assertEqual(factory.call_args.kwargs["token"], "owner-token")
        self.assertFalse(factory.call_args.kwargs["verbose"])
        self.assertFalse(factory.call_args.kwargs["download_files"])
        self.assertTrue(factory.call_args.kwargs["ssl_verify"])
        sent, secret = client.submit.call_args.args
        self.assertEqual([base64.b64decode(value) for value in sent], documents)
        self.assertEqual(secret, "server-secret")
        self.assertEqual(client.submit.call_args.kwargs, {"api_name": "/backend_ocr"})
        queued.result.assert_called_once_with(timeout=900)

    def test_invalid_or_over_limit_sources_never_construct_client(self):
        for documents in ([pdf(3)], [pdf(2), pdf()], [b"invalid"], []):
            model, factory, _, _ = models()
            with self.subTest(pages=len(documents)), self.assertRaises(InvalidImport):
                model.ocr_documents(documents)
            factory.assert_not_called()

    def test_remote_pdf_or_diagram_urls_are_never_downloaded(self):
        model, factory, _, _ = models()
        for value in ("https://example.com/source.pdf", "http://127.0.0.1/file", "data:application/pdf;base64,abcd"):
            with self.subTest(value=value), self.assertRaises(InvalidImport):
                model.ocr(value)
        with self.assertRaises(InvalidImport):
            model.image("https://example.com/image.png")
        factory.assert_not_called()

    def test_quota_error_is_sanitized_cancelled_and_not_resubmitted(self):
        model, _, client, queued = models(error=RuntimeError("ZeroGPU quota exceeded secret=owner-token"))
        with self.assertRaisesRegex(InvalidImport, "quota.*reset") as caught:
            model.ocr_documents([pdf()])
        self.assertNotIn("owner-token", str(caught.exception))
        queued.cancel.assert_called_once()
        client.submit.assert_called_once()

    def test_timeout_and_upstream_errors_do_not_leak_inputs_or_secrets(self):
        for error in (TimeoutError("server-secret"), RuntimeError("body contains owner-token")):
            model, _, client, queued = models(error=error)
            with self.subTest(error=type(error).__name__), self.assertRaises(InvalidImport) as caught:
                model.ocr_documents([pdf()])
            self.assertNotIn("server-secret", str(caught.exception))
            self.assertNotIn("owner-token", str(caught.exception))
            client.submit.assert_called_once()
            queued.cancel.assert_called_once()

    def test_missing_documents_pages_or_corrupt_ocr_are_rejected(self):
        for result in ({"result": []}, [], [[]], [[page(), page()]], [[{"markdown": {"text": 17}}]],
                       [[{**page(), "prunedResult": None}]], [[{**page(), "extra": float("nan")}]]):
            model, _, _, _ = models(result)
            with self.subTest(result=result), self.assertRaises(InvalidImport):
                model.ocr_documents([pdf()])

    def test_combined_preflight_loads_both_owned_pdfs_before_any_gpu(self):
        import_job = job()
        store = Store({import_job["paperPath"]: pdf(2), import_job["answerKeyPath"]: pdf()})
        model, factory, _, _ = models()
        with self.assertRaisesRegex(InvalidImport, "2 pages total"):
            parse_free_job(store, model, import_job)
        self.assertEqual(store.loads, [import_job["paperPath"], import_job["answerKeyPath"]])
        factory.assert_not_called()

    def test_wrong_owner_path_fails_before_storage_or_gpu(self):
        import_job = job()
        import_job["paperPath"] = import_job["paperPath"].replace("alice", "bob")
        store = Store({})
        model, factory, _, _ = models()
        with self.assertRaises(InvalidImport):
            parse_free_job(store, model, import_job)
        self.assertEqual(store.loads, [])
        factory.assert_not_called()

    def test_complete_import_preserves_latex_supplied_key_and_original_diagram(self):
        import_job = job()
        paper = page(PAPER_TEXT.replace("for $x=2$.", "for $x=2$. ![plot](fig.png)"))
        paper["prunedResult"]["parsing_res_list"] = [{"block_label": "image", "block_content": "fig.png",
                                                     "block_bbox": [10, 10, 50, 50]}]
        model, _, client, _ = models([[paper], [page(KEY_TEXT)]])
        store = Store({import_job["paperPath"]: pdf(), import_job["answerKeyPath"]: pdf()})
        with patch.object(model, "request_json", side_effect=AssertionError("No paid API")), \
                patch.object(model, "image", side_effect=AssertionError("Use original PDF crop")):
            result = parse_free_job(store, model, import_job)
        self.assertEqual(result["key"], [{"questionId": "q1", "correctOptionIndex": 1}])
        self.assertEqual(result["question"][0]["options"], ["$2$", "$4$"])
        self.assertIn("quiz-asset:paper-p1-img1", result["question"][0]["problem"])
        from PIL import Image
        with Image.open(io.BytesIO(next(iter(store.images.values())))) as image:
            self.assertEqual(image.size, (80, 80))
        self.assertEqual(result["question"][0]["images"][0]["storagePath"], next(iter(store.images)))
        client.submit.assert_called_once()

    def test_embedded_key_import_needs_one_document_and_explicit_key_heading(self):
        import_job = job(False)
        store = Store({import_job["paperPath"]: pdf()})
        model, _, client, _ = models([[page(PAPER_TEXT + "\nAnswer Key\n" + KEY_TEXT)]])
        result = parse_free_job(store, model, import_job)
        self.assertNotIn("answerKeyPath", result["source"])
        self.assertEqual(len(client.submit.call_args.args[0]), 1)
        self.assertEqual(result["key"][0]["correctOptionIndex"], 1)

    def test_worker_persists_quota_failure_terminally_without_ready_or_retry(self):
        store, model = Store({}), Mock()
        worker = FreeWorker(store, model)
        with patch("quiz_zerogpu.integration.Heartbeat") as heartbeat, \
                patch("quiz_zerogpu.integration.parse_free_job", side_effect=InvalidImport("GPU quota exhausted; retry later")) as parse:
            worker.process(job())
        parse.assert_called_once()
        self.assertEqual(store.updates[-1], ({"status": "failed", "message": "GPU quota exhausted; retry later",
                                             "error": "GPU quota exhausted; retry later"}, True))
        heartbeat.return_value.stop.assert_called()

    def test_lost_lease_cannot_publish_ready_draft(self):
        store, model = Store({}), Mock()
        worker = FreeWorker(store, model)
        with patch("quiz_zerogpu.integration.Heartbeat") as heartbeat, \
                patch("quiz_zerogpu.integration.parse_free_job", return_value={"question": []}):
            heartbeat.return_value.lost = True
            worker.process(job())
        self.assertEqual(store.updates, [])

    def test_shutdown_is_safe_before_start_and_when_repeated(self):
        model = Mock()
        worker = FreeWorker(Store({}), model)
        worker.stop()
        worker.stop()
        self.assertTrue(worker.stop_event.is_set())
        self.assertEqual(model.close.call_count, 2)

    def test_structure_uses_deterministic_supplied_key_without_provider_call(self):
        model, factory, _, _ = models()
        with patch.object(model, "request_json", side_effect=AssertionError("No Inference Providers")):
            result = model.structure(PAPER_TEXT, KEY_TEXT, [])
        self.assertEqual(result["key"][0]["correctOptionIndex"], 1)
        factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
