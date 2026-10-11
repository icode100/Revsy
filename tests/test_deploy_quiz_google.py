"""Offline plan safety and source-context isolation checks."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("deploy_quiz_google", ROOT / "scripts/deploy_quiz_google.py")
deployment = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deployment
spec.loader.exec_module(deployment)


class GoogleDeploymentTests(unittest.TestCase):
    def config(self, **changes):
        fields = {"project": "revsy-c66e0", "project_number": "123456789012",
                  "bucket": "revsy-c66e0.firebasestorage.app",
                  "frontend_origin": "https://revsy-c66e0.web.app"}
        fields.update(changes)
        return deployment.Config(**fields)

    def make_sources(self, root):
        files = {
            "services/quiz-gemini/Dockerfile": "FROM python:3.12-slim\n",
            "services/quiz-gemini/requirements.txt": "httpx>=0.28,<1\n",
            "services/quiz-parser/quiz_parser/__init__.py": "",
            "services/quiz-parser/quiz_parser/domain.py": "VALUE = 1\n",
            "services/quiz-gemini/quiz_gemini/__init__.py": "",
            "services/quiz-gemini/quiz_gemini/app.py": "VALUE = 2\n",
            ".env.deploy.local": "GEMINI_API_KEY=must-never-be-staged\n",
            "services/quiz-gemini/local-secret.json": "must-never-be-staged",
            "services/quiz-gemini/quiz_gemini/__pycache__/cache.pyc": "cache",
            "services/quiz-zerogpu/app.py": "must-never-be-staged",
        }
        for name, value in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)

    def test_context_excludes_environment_hf_cache_and_non_runtime_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_sources(root)
            files = deployment.source_files(root)
            self.assertEqual(set(files), {
                "Dockerfile", "services/quiz-gemini/requirements.txt",
                "services/quiz-parser/quiz_parser/__init__.py",
                "services/quiz-parser/quiz_parser/domain.py",
                "services/quiz-gemini/quiz_gemini/__init__.py",
                "services/quiz-gemini/quiz_gemini/app.py", ".gcloudignore", ".dockerignore"})
            self.assertNotIn(b"must-never-be-staged", b"".join(files.values()))

    def test_secret_version_must_be_pinned_numeric(self):
        with self.assertRaises(deployment.PlanError):
            deployment.validate(self.config(secret_version="latest"))

    def test_origin_rejects_wildcards_http_paths_and_credentials(self):
        for origin in ("http://localhost:5173", "https://user:pass@example.com",
                       "https://example.com/quizzes", "https://example.com?key=x",
                       "https://example.com\nmalicious", "https://*.example.com", "*"):
            with self.subTest(origin=origin), self.assertRaises(deployment.PlanError):
                deployment.validate(self.config(frontend_origin=origin))

    def test_plan_uses_request_billing_bounded_tasks_and_server_secret_reference(self):
        result = deployment.plan(self.config(), {"Dockerfile": b"safe"}, ROOT / ".deployment/google/test")
        self.assertEqual(result["mode"], "plan-only")
        release = next(item["argv"] for item in result["commands"] if item["stage"] == "release")
        for flag in ("--cpu-throttling", "--min-instances=0", "--max-instances=1",
                     "--concurrency=4", "--timeout=1800s",
                     "--set-secrets=GEMINI_API_KEY=revsy-gemini-api-key:1"):
            self.assertIn(flag, release)
        self.assertNotIn("GEMINI_API_KEY", result["runtimeEnvironment"])
        queue = next(item["argv"] for item in result["commands"]
                     if item["argv"][:4] == ["gcloud", "tasks", "queues", "create"])
        self.assertIn("--max-concurrent-dispatches=1", queue)
        self.assertIn("--max-attempts=3", queue)

    def test_hosting_release_cannot_publish_security_rules(self):
        config = deployment.hosting_config(self.config())
        self.assertEqual(set(config), {"hosting"})
        rewrites = config["hosting"]["rewrites"]
        self.assertEqual(rewrites[0]["source"], "/api/**")
        self.assertEqual(rewrites[-1], {"source": "**", "destination": "/index.html"})
        self.assertFalse(any("internal" in entry["source"] for entry in rewrites))

    def test_build_identity_is_inspected_in_the_same_region_before_build(self):
        result = deployment.plan(self.config(), {"Dockerfile": b"safe"}, ROOT / ".deployment/google/test")
        commands = [item["argv"] for item in result["commands"]]
        inspection = next(command for command in commands
                          if command[:3] == ["gcloud", "builds", "get-default-service-account"])
        build = next(command for command in commands
                     if command[:3] == ["gcloud", "builds", "submit"])
        self.assertLess(commands.index(inspection), commands.index(build))
        self.assertIn("--region=us-central1", inspection)
        self.assertIn("--region=us-central1", build)

    def test_task_iam_stays_scoped_and_managed_agent_role_is_verified(self):
        config = self.config()
        result = deployment.plan(config, {"Dockerfile": b"safe"}, ROOT / ".deployment/google/test")
        commands = [item["argv"] for item in result["commands"]]
        enqueuer = next(command for command in commands if "--role=roles/cloudtasks.enqueuer" in command)
        self.assertEqual(enqueuer[:5], ["gcloud", "tasks", "queues", "add-iam-policy-binding", deployment.QUEUE])
        identity_grants = [command for command in commands if "--role=roles/iam.serviceAccountUser" in command]
        self.assertEqual(len(identity_grants), 2)
        self.assertTrue(all(command[4] == config.task_email for command in identity_grants))
        self.assertFalse(any("TokenCreator" in argument for command in commands for argument in command))
        self.assertTrue(any(command[:3] == ["gcloud", "projects", "get-iam-policy"] for command in commands))
        self.assertTrue(any("roles/cloudtasks.serviceAgent" in entry for entry in result["manualPrerequisites"]))
        enable = next(command for command in commands if command[:3] == ["gcloud", "services", "enable"])
        self.assertIn("iam.googleapis.com", enable)

    def test_no_google_commands_are_executed_or_credentials_read(self):
        source = (ROOT / "scripts/deploy_quiz_google.py").read_text()
        for forbidden in ("import subprocess", "os.environ", "read_deploy_env", "import httpx"):
            self.assertNotIn(forbidden, source)

    def test_output_must_be_fresh_ignored_child_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {"Dockerfile": b"safe"}
            output = root / ".deployment/google/review"
            result = deployment.plan(self.config(), files, output)
            deployment.write_plan(result, files, output, root)
            self.assertEqual((output / "context/Dockerfile").read_bytes(), b"safe")
            config = json.loads((output / "hosting/firebase.json").read_text())
            self.assertEqual((output / "hosting" / config["hosting"]["public"]).resolve(), (root / "dist").resolve())
            with self.assertRaises(deployment.PlanError):
                deployment.write_plan(result, files, output, root)
            with self.assertRaises(deployment.PlanError):
                deployment.write_plan(result, files, root / "outside", root)

    def test_source_hash_changes_if_named_source_changes(self):
        self.assertNotEqual(deployment.source_digest({"app.py": b"first"}),
                            deployment.source_digest({"app.py": b"second"}))


if __name__ == "__main__":
    unittest.main()
