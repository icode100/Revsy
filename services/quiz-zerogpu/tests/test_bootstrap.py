import unittest

from quiz_zerogpu.bootstrap import firebase_settings


def configured(**overrides):
    values = {"FIREBASE_PROJECT_ID": "test-project", "FIREBASE_STORAGE_BUCKET": "test-project.firebasestorage.app",
              "HF_TOKEN": "fake-server-hf-token", "QUIZ_OCR_TOKEN": "fake-server-ocr-token-" + "x" * 48,
              "ALLOWED_ORIGINS": "https://revsy.example", "QUIZ_SPACE_URL": "https://test-revsy.hf.space"}
    values.update(overrides)
    return values


class BootstrapTests(unittest.TestCase):
    def test_exact_production_origins_and_server_secrets_are_retained(self):
        values = configured(ALLOWED_ORIGINS="https://revsy.example, https://preview.example")
        settings = firebase_settings(values)
        self.assertEqual(settings.origins, ("https://revsy.example", "https://preview.example"))
        self.assertEqual(settings.bucket, "test-project.firebasestorage.app")
        self.assertEqual(settings.project_id, "test-project")
        self.assertEqual(settings.hf_token, values["HF_TOKEN"])
        self.assertEqual(settings.paddle_token, values["QUIZ_OCR_TOKEN"])
        self.assertEqual(settings.paddle_url, values["QUIZ_SPACE_URL"])

    def test_no_paid_model_or_native_paddle_settings_are_required(self):
        values = configured()
        self.assertNotIn("PADDLEOCR_URL", values)
        self.assertNotIn("PADDLEOCR_TOKEN", values)
        self.assertNotIn("HF_INFERENCE_TOKEN", values)
        self.assertNotIn("HF_STRUCTURING_MODEL", values)
        settings = firebase_settings(values)
        self.assertEqual(settings.structuring_model, "deterministic numbered MCQs")
        self.assertEqual(settings.image_hosts, ())

    def test_missing_or_blank_required_settings_fail_without_echoing_secrets(self):
        for key in ("FIREBASE_PROJECT_ID", "FIREBASE_STORAGE_BUCKET", "HF_TOKEN", "QUIZ_OCR_TOKEN", "ALLOWED_ORIGINS", "QUIZ_SPACE_URL"):
            for missing_value in (None, "", " \t "):
                values = configured()
                if missing_value is None:
                    del values[key]
                else:
                    values[key] = missing_value
                with self.subTest(key=key, value=missing_value):
                    with self.assertRaises(RuntimeError) as raised:
                        firebase_settings(values)
                    self.assertNotIn("fake-server-hf-token", str(raised.exception))
                    self.assertNotIn("fake-server-ocr-token", str(raised.exception))

    def test_public_http_and_non_origin_values_are_rejected(self):
        for origin in ("http://revsy.example", "https://*.example", "*", "https://user:pass@revsy.example",
                       "https://revsy.example/quizzes", "https://revsy.example?token=secret", "https://revsy.example#fragment",
                       "https://revsy.example:wrong", "ftp://revsy.example", "https:///missing-host", "//revsy.example"):
            with self.subTest(origin=origin), self.assertRaises(RuntimeError):
                firebase_settings(configured(ALLOWED_ORIGINS=origin))

    def test_local_http_development_origins_and_trailing_slash_normalization(self):
        settings = firebase_settings(configured(ALLOWED_ORIGINS="https://revsy.example/, http://localhost:5173, http://127.0.0.1:8000"))
        self.assertEqual(settings.origins, ("https://revsy.example", "http://localhost:5173", "http://127.0.0.1:8000"))

    def test_canonical_hf_host_only_and_accepted_https_host_normalization(self):
        for url in ("http://test-revsy.hf.space", "https://test-revsy.hf.space/api", "https://huggingface.co/spaces/test/revsy",
                    "https://revsy.example", "https://test-revsy.hf.space?token=secret", "https://user:pass@test-revsy.hf.space",
                    "https://test-revsy.hf.space:8443", "https://test-revsy.hf.space#x", "https://nested.test-revsy.hf.space"):
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                firebase_settings(configured(QUIZ_SPACE_URL=url))
        settings = firebase_settings(configured(QUIZ_SPACE_URL="https://test-revsy.hf.space:443/"))
        self.assertEqual(settings.paddle_url, "https://test-revsy.hf.space")


if __name__ == "__main__":
    unittest.main()
