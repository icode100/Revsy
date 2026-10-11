"""CPU-only contract tests: no model download, CUDA, or credentials required."""

from types import SimpleNamespace
import unittest

import numpy as np
from PIL import Image

from ocr import MAX_NEW_TOKENS, OCRLimitError, OCRRunner, _guard_generation, _pipeline_config


class FakePipeline:
    def __init__(self, blocks=None, width=100, height=100):
        self.calls = []
        self.blocks = blocks or [
            {"block_label": "number", "block_content": "1.", "block_bbox": [0, 0, 10, 10]},
            {"block_label": "text", "block_content": "Find $x^2$.\n(A) 2\n(B) 4", "block_bbox": [0, 10, 100, 50]},
            {"block_label": "image", "block_content": "", "block_bbox": [10, 50, 90, 90]},
            {"block_label": "text", "block_content": "Answer key: 1 B", "block_bbox": [0, 90, 100, 100]},
        ]
        self.width, self.height = width, height

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        yield SimpleNamespace(json={"res": {"width": self.width, "height": self.height,
                                             "parsing_res_list": self.blocks}})


class OCRRunnerTests(unittest.TestCase):
    def test_preserves_math_numbers_key_and_original_diagram_box(self):
        pipeline = FakePipeline()
        page = OCRRunner(pipeline=pipeline).parse_pages([Image.new("RGB", (100, 100), (1, 2, 3))])[0]
        self.assertEqual(page["markdown"]["text"], "1.\n\nFind $x^2$.\n(A) 2\n(B) 4\n\n![Source diagram](__layout_block_2)\n\nAnswer key: 1 B")
        self.assertEqual(page["prunedResult"]["parsing_res_list"][2]["block_bbox"], [10, 50, 90, 90])
        self.assertEqual(page["markdown"]["images"], {})
        self.assertEqual(pipeline.calls[0]["input"][0, 0].tolist(), [3, 2, 1])
        self.assertFalse(pipeline.calls[0]["use_queues"])
        self.assertEqual(pipeline.calls[0]["max_new_tokens"], MAX_NEW_TOKENS)

    def test_each_page_keeps_own_index_and_single_page_inference(self):
        pipeline = FakePipeline()
        pages = OCRRunner(pipeline=pipeline).parse_pages([Image.new("RGB", (100, 100)) for _ in range(2)])
        self.assertEqual([page["prunedResult"]["page_index"] for page in pages], [0, 1])
        self.assertEqual(len(pipeline.calls), 2)

    def test_rejects_more_than_two_pages_before_inference(self):
        pipeline = FakePipeline()
        with self.assertRaisesRegex(OCRLimitError, "two pages"):
            OCRRunner(pipeline=pipeline).parse_pages([Image.new("RGB", (100, 100)) for _ in range(3)])
        self.assertEqual(pipeline.calls, [])

    def test_rejects_dimensions_changed_by_model(self):
        with self.assertRaisesRegex(OCRLimitError, "dimensions changed"):
            OCRRunner(pipeline=FakePipeline(width=50)).parse_pages([Image.new("RGB", (100, 100))])

    def test_rejects_invalid_source_coordinates(self):
        for bbox in ([0, 0, 101, 100], [0, 0, float("nan"), 100], [10, 0, 5, 100]):
            with self.subTest(bbox=bbox), self.assertRaises(OCRLimitError):
                OCRRunner(pipeline=FakePipeline(blocks=[{"block_label": "image", "block_content": "", "block_bbox": bbox}])).parse_pages([Image.new("RGB", (100, 100))])

    def test_busy_runner_does_not_start_concurrent_gpu_work(self):
        pipeline = FakePipeline()
        runner = OCRRunner(pipeline=pipeline)
        runner._lock.acquire()
        try:
            with self.assertRaisesRegex(OCRLimitError, "already reading"):
                runner.parse_pages([Image.new("RGB", (100, 100))])
            self.assertEqual(pipeline.calls, [])
        finally:
            runner._lock.release()

    def test_failed_call_releases_lock_for_retry(self):
        pipeline = FakePipeline(width=50)
        runner = OCRRunner(pipeline=pipeline)
        with self.assertRaises(OCRLimitError):
            runner.parse_pages([Image.new("RGB", (100, 100))])
        pipeline.width = 100
        self.assertEqual(len(runner.parse_pages([Image.new("RGB", (100, 100))])), 1)

    def test_layout_dtype_and_vlm_dtype_are_separate(self):
        original = {"SubModules": {"LayoutDetection": {}, "VLRecognition": {}}}
        config = _pipeline_config(original)
        self.assertEqual(config["SubModules"]["LayoutDetection"]["engine_config"]["dtype"], "float32")
        self.assertEqual(config["SubModules"]["VLRecognition"]["engine_config"]["dtype"], "bfloat16")
        self.assertEqual(config["markdown_ignore_labels"], [])
        self.assertFalse(config["use_queues"])
        self.assertEqual(original, {"SubModules": {"LayoutDetection": {}, "VLRecognition": {}}})


class GenerationGuardTests(unittest.TestCase):
    def predictor(self, output, eos=2):
        calls = []
        def generate(inputs, kwargs):
            calls.append(kwargs)
            return np.array(output)
        predictor = SimpleNamespace(generate=generate, infer=SimpleNamespace(generation_config=SimpleNamespace(eos_token_id=eos)))
        _guard_generation(predictor)
        return predictor, calls

    def test_token_exhaustion_cannot_be_returned_as_complete_text(self):
        predictor, _ = self.predictor([[9, 9, 4, 5, 6]])
        with self.assertRaisesRegex(OCRLimitError, "token limit"):
            predictor.generate({"input_ids": np.array([[9, 9]])}, {"max_new_tokens": 3})

    def test_eos_at_boundary_is_complete_and_sampling_disabled(self):
        predictor, calls = self.predictor([[9, 9, 4, 5, 2]])
        output = predictor.generate({"input_ids": np.array([[9, 9]])}, {"max_new_tokens": 3})
        self.assertEqual(output.tolist(), [[9, 9, 4, 5, 2]])
        self.assertFalse(calls[0]["do_sample"])
        self.assertIsNone(calls[0]["forced_eos_token_id"])

    def test_short_completed_output_is_accepted(self):
        predictor, _ = self.predictor([[9, 9, 4, 2]])
        self.assertEqual(predictor.generate({"input_ids": np.array([[9, 9]])}, {"max_new_tokens": 3}).tolist(), [[9, 9, 4, 2]])


if __name__ == "__main__":
    unittest.main()
