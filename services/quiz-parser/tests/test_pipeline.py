import base64
import io
import socket
from types import SimpleNamespace
import unittest

from quiz_parser.domain import InvalidImport
from quiz_parser.pipeline import Models, OriginalPages, preserve_paper, safe_remote_image, validated_pdf
from test_domain import PREFIX


class PipelineTests(unittest.TestCase):
    def test_ssrf_rejects_non_https_credentials_wrong_host_and_private_dns(self):
        def public(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]

        for url in ("http://images.example/a.png", "https://user:pass@images.example/a.png",
                    "https://evil.example/a.png", "https://images.example:8443/a.png"):
            with self.assertRaises(InvalidImport):
                safe_remote_image(url, ("images.example",), public)

        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "192.168.0.10"):
            def local(*args, **kwargs):
                return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
            with self.assertRaises(InvalidImport):
                safe_remote_image("https://images.example/a.png", ("images.example",), local)
        url, hostname = safe_remote_image("https://images.example/a.png?signature=opaque", ("images.example",), public)
        self.assertEqual(url, "https://8.8.8.8/a.png?signature=opaque")
        self.assertEqual(hostname, "images.example")

    def test_image_base64_is_validated_and_unsafe_urls_are_not_fetched(self):
        from PIL import Image
        image = io.BytesIO()
        Image.new("RGB", (4, 4), "white").save(image, format="PNG")
        models = Models(SimpleNamespace(image_hosts=()))
        self.assertEqual(models.image(base64.b64encode(image.getvalue()).decode())[:8], b"\x89PNG\r\n\x1a\n")
        for value in ("invalid^base64", "https://127.0.0.1/private", "data:text/html;base64,PHNjcmlwdD4="):
            with self.assertRaises(InvalidImport):
                models.image(value)

    def test_pdf_page_limit_and_encryption_are_enforced(self):
        from pypdf import PdfWriter
        for pages, encrypted in ((1, False), (31, False), (1, True)):
            writer = PdfWriter()
            for _ in range(pages):
                writer.add_blank_page(width=100, height=100)
            if encrypted:
                writer.encrypt("secret")
            output = io.BytesIO()
            writer.write(output)
            if pages > 30 or encrypted:
                with self.assertRaises(InvalidImport):
                    validated_pdf(output.getvalue())
            else:
                self.assertEqual(validated_pdf(output.getvalue()), 1)

    def test_original_bbox_crop_and_fallback_keep_asset_refs(self):
        calls = []
        original = SimpleNamespace(image=lambda *args: calls.append(args) or b"original pixels")
        models = SimpleNamespace(image=lambda value: (_ for _ in ()).throw(InvalidImport("blocked URL")))

        class Store:
            def save_image(self, job, asset_id, content, page):
                self_content.append(content)
                return {"id": asset_id, "storagePath": PREFIX + asset_id + ".png", "page": page}

        self_content, warnings = [], []
        pages = [{"markdown": {"text": "Q1 ![chart](imgs/chart.png)", "images": {"imgs/chart.png": "untrusted"}},
                  "prunedResult": {"width": 100, "height": 200, "parsing_res_list": [
                      {"block_content": "imgs/chart.png", "block_bbox": [1, 2, 30, 40]}]}}]
        text, assets = preserve_paper(pages, original, models, Store(), {}, warnings)
        self.assertIn("quiz-asset:paper-p1-img1", text)
        self.assertEqual(calls, [(0, [1, 2, 30, 40], (100, 200))])
        self.assertEqual(self_content, [b"original pixels"])
        pages[0]["prunedResult"] = {}
        preserve_paper(pages, original, models, Store(), {}, warnings)
        self.assertEqual(calls[-1], (0,))
        self.assertTrue(warnings)

    def test_html_diagram_keeps_position_between_questions(self):
        models = SimpleNamespace(image=lambda value: b"verified source")
        original = SimpleNamespace(image=lambda *args: b"source page")
        store = SimpleNamespace(save_image=lambda job, asset_id, content, page:
                                {"id": asset_id, "page": page, "storagePath": PREFIX + "assets/" + asset_id + ".png"})
        pages = [{"markdown": {"text": "Q1. First\n<img src='imgs/chart.png' width='300'>\nQ2. Second",
                               "images": {"imgs/chart.png": "verified"}}}]
        text, assets = preserve_paper(pages, original, models, store, {}, [])
        self.assertLess(text.index("Q1"), text.index("quiz-asset:paper-p1-img1"))
        self.assertLess(text.index("quiz-asset:paper-p1-img1"), text.index("Q2"))
        self.assertNotIn("<img", text)
        self.assertEqual(len(assets), 1)

    def test_missing_image_map_keeps_detected_vector_plot_with_warning(self):
        calls = []
        original = SimpleNamespace(image=lambda *args: calls.append(args) or b"original scan")
        store = SimpleNamespace(save_image=lambda job, asset_id, content, page:
                                {"id": asset_id, "page": page, "storagePath": PREFIX + "assets/" + asset_id + ".png"})
        pages = [{"markdown": {"text": "Q1. First\nQ2. Second", "images": {}},
                  "prunedResult": {"parsing_res_list": [
                      {"block_label": "text", "block_content": "Q1. First"},
                      {"block_label": "chart", "block_content": "", "block_bbox": [1, 2, 30, 40]},
                      {"block_label": "text", "block_content": "Q2. Second"}]}}]
        warnings = []
        models = SimpleNamespace(image=lambda value: self.fail("Missing image maps must use the original PDF"))
        text, assets = preserve_paper(pages, original, models, store, {}, warnings)
        self.assertEqual(calls, [(0,)])
        self.assertLess(text.index("quiz-asset:paper-p1-img1"), text.index("Q2"))
        self.assertEqual(len(assets), 1)
        self.assertTrue(warnings)

    def test_vector_only_pdf_diagram_survives_original_crop(self):
        from PIL import Image
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, NameObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=100, height=100)
        drawing = DecodedStreamObject()
        drawing.set_data(b"0 0 1 rg 10 10 60 60 re f")
        page[NameObject("/Contents")] = writer._add_object(drawing)
        pdf = io.BytesIO()
        writer.write(pdf)
        original = OriginalPages(pdf.getvalue())
        try:
            png = original.image(0, [10, 30, 70, 90], (100, 100))
        finally:
            original.close()
        with Image.open(io.BytesIO(png)) as image:
            self.assertEqual(image.size, (120, 120))
            self.assertEqual(image.convert("RGB").getpixel((60, 60)), (0, 0, 255))

    def test_layout_marker_does_not_save_the_same_diagram_twice(self):
        calls = []
        original = SimpleNamespace(image=lambda *args: calls.append(args) or b"original crop")
        models = SimpleNamespace(image=lambda _value: self.fail("Use the original PDF"))
        store = SimpleNamespace(save_image=lambda job, asset_id, content, page:
                                {"id": asset_id, "page": page, "storagePath": PREFIX + "assets/" + asset_id + ".png"})
        pages = [{"markdown": {"text": "Q1. First\n![diagram](__layout_block_1)\nQ2. Second", "images": {}},
                  "prunedResult": {"width": 100, "height": 100, "parsing_res_list": [
                      {"block_label": "text", "block_content": "Q1. First"},
                      {"block_label": "image", "block_content": "", "block_bbox": [10, 20, 50, 60]}]}}]
        text, assets = preserve_paper(pages, original, models, store, {}, [])
        self.assertEqual(len(assets), 1)
        self.assertEqual(calls, [(0, [10, 20, 50, 60], (100, 100))])
        self.assertEqual(text.count("quiz-asset:paper-p1-img1"), 1)


if __name__ == "__main__":
    unittest.main()
