import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from deploy_quiz_zerogpu import (
    DeployConfig, DeploymentError, MARKER, canonical_space_url, deploy,
    load_service_account, upload_operations,
)


def operation(**kwargs):
    return SimpleNamespace(**kwargs)


class ZeroGPUDeployTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        space = self.root / "services" / "quiz-zerogpu"
        parser = self.root / "services" / "quiz-parser" / "quiz_parser"
        (space / "quiz_zerogpu").mkdir(parents=True)
        parser.mkdir(parents=True)
        for name in ("app.py", "ocr.py", "requirements.txt"):
            (space / name).write_text("runtime source", encoding="utf-8")
        (space / "README.md").write_text("---\nsdk: gradio\n---\n", encoding="utf-8")
        (space / "revsy-service.json").write_text(json.dumps(MARKER), encoding="utf-8")
        for directory in (space / "quiz_zerogpu", parser):
            (directory / "__init__.py").write_text("", encoding="utf-8")
            (directory / "runtime.py").write_text("runtime", encoding="utf-8")
            (directory / "do-not-upload.env").write_text("private configuration", encoding="utf-8")
            (directory / "__pycache__").mkdir()
            (directory / "__pycache__" / "secret.py").write_text("secret", encoding="utf-8")
        (space / ".env").write_text("SECRET=never uploaded", encoding="utf-8")
        (self.root / "credentials.json").write_text("never uploaded", encoding="utf-8")
        self.config = DeployConfig("alice", update_existing=True)
        self.api = Mock()
        self.api.repo_exists.return_value = True
        self.api.space_info.return_value = SimpleNamespace(sdk="gradio", private=False,
            host="alice-revsy-quiz-zerogpu.hf.space", sha="revision1")
        self.api.get_space_runtime.return_value = SimpleNamespace(hardware="zero-a10g", requested_hardware="zero-a10g")
        self.marker_loader = Mock(return_value=MARKER)

    def run_deploy(self, config=None, **kwargs):
        return deploy(self.api, config or self.config, self.root, token="deployment-token",
                      operation_add=operation, marker_loader=self.marker_loader,
                      token_factory=lambda _: "generated-backend-token-" + "a" * 40, **kwargs)

    def assert_no_mutations(self):
        for name in ("create_repo", "upload_file", "add_space_secret", "add_space_variable", "create_commit", "request_space_hardware"):
            getattr(self.api, name).assert_not_called()

    def test_preview_uploads_no_firebase_or_hf_credentials(self):
        result = self.run_deploy()
        self.assertFalse(result["firebase_enabled"])
        self.assertEqual([call.kwargs["key"] for call in self.api.add_space_secret.call_args_list], ["QUIZ_OCR_TOKEN"])
        variables = {call.kwargs["key"]: call.kwargs["value"] for call in self.api.add_space_variable.call_args_list}
        self.assertEqual(variables["QUIZ_ENABLE_FIREBASE"], "false")
        self.assertEqual(variables["QUIZ_SPACE_URL"], "https://alice-revsy-quiz-zerogpu.hf.space")
        self.api.request_space_hardware.assert_not_called()
        self.api.create_repo.assert_not_called()
        self.assertEqual(self.api.create_commit.call_args.kwargs["parent_commit"], "revision1")

    def test_new_space_requests_zero_gpu_at_creation_only_and_marks_recovery(self):
        self.api.repo_exists.return_value = False
        self.run_deploy(DeployConfig("alice"))
        args = self.api.create_repo.call_args.kwargs
        self.assertEqual(args["space_sdk"], "gradio")
        self.assertEqual(args["space_hardware"], "zero-a10g")
        self.assertFalse(args["exist_ok"])
        self.assertEqual(json.loads(self.api.upload_file.call_args.kwargs["path_or_fileobj"]), MARKER)
        self.assertEqual(self.api.mock_calls[2][0], "upload_file")
        self.api.request_space_hardware.assert_not_called()

    def test_missing_update_flag_or_unrelated_marker_refused_before_changes(self):
        with self.assertRaises(DeploymentError):
            self.run_deploy(DeployConfig("alice"))
        self.assert_no_mutations()
        self.marker_loader.return_value = {**MARKER, "service": "other"}
        with self.assertRaises(DeploymentError):
            self.run_deploy()
        self.assert_no_mutations()

    def test_paid_hardware_cpu_hardware_private_and_wrong_sdk_refused(self):
        for hardware, requested in (("t4-small", "zero-a10g"), ("zero-a10g", "t4-medium"), ("cpu-basic", "cpu-basic"), (None, None)):
            self.api.get_space_runtime.return_value = SimpleNamespace(hardware=hardware, requested_hardware=requested)
            with self.subTest(hardware=hardware, requested=requested), self.assertRaises(DeploymentError):
                self.run_deploy()
            self.assert_no_mutations()
        self.api.get_space_runtime.return_value = SimpleNamespace(hardware="zero-a10g", requested_hardware=None)
        for sdk, private in (("docker", False), ("gradio", True)):
            self.api.space_info.return_value = SimpleNamespace(sdk=sdk, private=private)
            with self.subTest(sdk=sdk), self.assertRaises(DeploymentError):
                self.run_deploy()
            self.assert_no_mutations()

    def test_pending_zero_gpu_build_permitted_without_hardware_change(self):
        self.api.get_space_runtime.return_value = SimpleNamespace(hardware=None, requested_hardware="zero-a10g")
        self.run_deploy()
        self.api.request_space_hardware.assert_not_called()

    def test_source_allowlist_is_frozen_and_excludes_configuration_and_caches(self):
        operations = upload_operations(self.root, operation)
        targets = {item.path_in_repo for item in operations}
        self.assertEqual(targets, {"app.py", "ocr.py", "README.md", "requirements.txt", "revsy-service.json",
                                   "quiz_zerogpu/__init__.py", "quiz_zerogpu/runtime.py",
                                   "quiz_parser/__init__.py", "quiz_parser/runtime.py"})
        self.assertTrue(all(isinstance(item.path_or_fileobj, bytes) for item in operations))

    def test_missing_source_and_mismatched_local_identity_refused_before_changes(self):
        source = self.root / "services" / "quiz-zerogpu"
        (source / "ocr.py").unlink()
        with self.assertRaises(DeploymentError):
            self.run_deploy()
        self.assert_no_mutations()
        (source / "ocr.py").write_text("runtime", encoding="utf-8")
        (source / "revsy-service.json").write_text(json.dumps({**MARKER, "schemaVersion": 2}), encoding="utf-8")
        with self.assertRaises(DeploymentError):
            self.run_deploy()
        self.assert_no_mutations()

    def test_firebase_requires_explicit_flag_and_valid_matching_account(self):
        config = DeployConfig("alice", update_existing=True, enable_firebase=True,
            firebase_project="revsy-c66e0", firebase_bucket="revsy-c66e0.firebasestorage.com", frontend_origin="https://revsy.example/")
        account = {"type": "service_account", "project_id": "revsy-c66e0", "client_email": "test@example.com", "private_key": "test-only"}
        with self.assertRaises(DeploymentError):
            self.run_deploy(config, service_account={**account, "project_id": "other-project"})
        self.assert_no_mutations()
        self.run_deploy(config, service_account=account)
        values = {call.kwargs["key"]: call.kwargs["value"] for call in self.api.add_space_secret.call_args_list}
        self.assertEqual(values["HF_TOKEN"], "deployment-token")
        self.assertEqual(json.loads(values["FIREBASE_SERVICE_ACCOUNT_JSON"]), account)
        variables = {call.kwargs["key"]: call.kwargs["value"] for call in self.api.add_space_variable.call_args_list}
        self.assertEqual(variables["QUIZ_ENABLE_FIREBASE"], "true")
        self.assertEqual(variables["ALLOWED_ORIGINS"], "https://revsy.example")

    def test_external_service_account_guard_runs_before_reading_repository_file(self):
        with self.assertRaisesRegex(DeploymentError, "outside"):
            load_service_account(self.root / "credentials.json", self.root, "revsy-c66e0")

    def test_canonical_host_and_zero_only_guard_reject_unsafe_destinations(self):
        for host in (None, "http://alice.hf.space", "https://alice.hf.space/path", "https://alice.hf.space?secret=bad", "https://other.example"):
            with self.subTest(host=host), self.assertRaises(DeploymentError):
                canonical_space_url(host)
        with self.assertRaises(DeploymentError):
            self.run_deploy(zero_hardware="t4-small")
        self.assert_no_mutations()


if __name__ == "__main__":
    unittest.main()
