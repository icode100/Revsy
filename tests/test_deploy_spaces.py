import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from scripts.deploy_quiz_spaces import main, read_deploy_env


class FakeHub:
    def __init__(self):
        self.existing = set()
        self.mutations = []

    def repo_exists(self, repo_id, **_):
        return repo_id in self.existing

    def space_info(self, repo_id):
        return SimpleNamespace(host='https://canonical-test.hf.space', private=False)

    def create_repo(self, **kwargs):
        self.mutations.append(('create', kwargs))

    def add_space_secret(self, **kwargs):
        self.mutations.append(('secret', kwargs))

    def add_space_variable(self, **kwargs):
        self.mutations.append(('variable', kwargs))

    def upload_folder(self, **kwargs):
        self.mutations.append(('upload', kwargs))

    def upload_file(self, **kwargs):
        self.mutations.append(('marker', kwargs))


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.account = Path(self.temp.name) / 'service-account.json'
        self.account.write_text(json.dumps({'type': 'service_account', 'project_id': 'demo-project',
                                           'private_key': 'FAKE-KEY'}), encoding='utf-8')
        self.api = FakeHub()
        self.received_tokens = []
        self.hub = ModuleType('huggingface_hub')
        self.hub.HfApi = lambda **kwargs: self.received_tokens.append(kwargs['token']) or self.api
        self.hub.get_token = lambda: 'FAKE-HF-TOKEN'
        self.hub.hf_hub_download = lambda **_: (_ for _ in ()).throw(ValueError('No marker'))
        self.args = ['deploy', '--namespace', 'icode100', '--frontend-origin', 'https://revsy.example',
                     '--firebase-project', 'demo-project', '--firebase-bucket', 'demo-project.appspot.com',
                     '--service-account-file', str(self.account)]

    def run_deploy(self, extra=()):
        with patch.dict(sys.modules, {'huggingface_hub': self.hub}), patch.object(sys, 'argv', self.args + list(extra)), \
                contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()):
            main()
        return output.getvalue()

    def test_new_spaces_separate_code_from_secrets_and_do_not_upgrade_hardware(self):
        output = self.run_deploy()
        self.assertNotIn('FAKE-KEY', output)
        self.assertNotIn('FAKE-HF-TOKEN', output)
        uploads = [kwargs for action, kwargs in self.api.mutations if action == 'upload']
        self.assertEqual(len(uploads), 2)
        self.assertEqual(len([action for action, _ in self.api.mutations if action == 'marker']), 2)
        self.assertTrue(all('revsy-service.json' in upload['allow_patterns'] for upload in uploads))
        self.assertTrue(all('.env' not in upload['allow_patterns'] for upload in uploads))
        self.assertTrue(all(kwargs['exist_ok'] is False for action, kwargs in self.api.mutations if action == 'create'))
        shared = [kwargs['value'] for action, kwargs in self.api.mutations
                  if action == 'secret' and kwargs['key'] == 'PADDLEOCR_TOKEN']
        self.assertEqual(len(shared), 2)
        self.assertEqual(shared[0], shared[1])
        self.assertIn('canonical-test.hf.space', output)

    def test_existing_space_rejected_before_any_mutation(self):
        self.api.existing.add('icode100/revsy-quiz-parser')
        with self.assertRaises(SystemExit):
            self.run_deploy()
        self.assertEqual(self.api.mutations, [])

    def test_same_repo_for_both_services_rejected_before_any_mutation(self):
        with self.assertRaises(SystemExit):
            self.run_deploy(['--worker-name', 'one-space', '--ocr-name', 'one-space'])
        self.assertEqual(self.api.mutations, [])

    def test_credentials_inside_repository_rejected_before_any_mutation(self):
        self.args[-1] = str(Path(__file__).resolve().parents[1] / 'services' / 'quiz-parser' / 'service-account.json')
        with patch.object(Path, 'read_text', return_value=self.account.read_text(encoding='utf-8')):
            with self.assertRaises(SystemExit):
                self.run_deploy()
        self.assertEqual(self.api.mutations, [])

    def test_explicit_update_still_rejects_missing_service_marker(self):
        self.api.existing.add('icode100/revsy-paddleocr')
        with self.assertRaises(SystemExit):
            self.run_deploy(['--update-existing'])
        self.assertEqual(self.api.mutations, [])

    def write_env(self, **overrides):
        values = {
            'HF_TOKEN': 'FILE-DEPLOY-TOKEN', 'HF_INFERENCE_TOKEN': 'FILE-INFERENCE-TOKEN',
            'HF_NAMESPACE': 'icode100', 'FRONTEND_ORIGIN': 'https://revsy.example',
            'FIREBASE_PROJECT_ID': 'demo-project', 'FIREBASE_STORAGE_BUCKET': 'demo-project.appspot.com',
            'FIREBASE_SERVICE_ACCOUNT_FILE': str(self.account),
        }
        values.update(overrides)
        env = Path(self.temp.name) / '.env.deploy.local'
        env.write_text('\n'.join(f'{key}="{value}"' for key, value in values.items()), encoding='utf-8')
        return env

    def test_env_file_configures_deployment_without_exposing_tokens(self):
        env = self.write_env()
        self.args = ['deploy', '--env-file', str(env)]
        output = self.run_deploy()
        self.assertEqual(self.received_tokens, ['FILE-DEPLOY-TOKEN'])
        self.assertNotIn('FILE-DEPLOY-TOKEN', output)
        self.assertNotIn('FILE-INFERENCE-TOKEN', output)
        inference = [kwargs['value'] for action, kwargs in self.api.mutations
                     if action == 'secret' and kwargs['key'] == 'HF_TOKEN']
        self.assertEqual(inference, ['FILE-INFERENCE-TOKEN'])

    def test_cli_overrides_env_config_and_blank_inference_uses_deployment_token(self):
        env = self.write_env(FIREBASE_PROJECT_ID='different-project', HF_INFERENCE_TOKEN='')
        self.args = ['deploy', '--env-file', str(env), '--firebase-project', 'demo-project']
        with patch.dict('os.environ', {'HF_INFERENCE_TOKEN': ''}):
            self.run_deploy()
        inference = [kwargs['value'] for action, kwargs in self.api.mutations
                     if action == 'secret' and kwargs['key'] == 'HF_TOKEN']
        self.assertEqual(inference, ['FILE-DEPLOY-TOKEN'])

    def test_env_unknown_setting_fails_before_any_mutation_without_echoing_value(self):
        env = self.write_env()
        with env.open('a', encoding='utf-8') as file:
            file.write('\nVITE_PRIVATE_TOKEN=NEVER-ECHO-THIS')
        self.args = ['deploy', '--env-file', str(env)]
        with contextlib.redirect_stderr(io.StringIO()) as errors, \
                patch.dict(sys.modules, {'huggingface_hub': self.hub}), patch.object(sys, 'argv', self.args):
            with self.assertRaises(SystemExit):
                main()
        self.assertNotIn('NEVER-ECHO-THIS', errors.getvalue())
        self.assertEqual(self.api.mutations, [])

    def test_env_values_are_literal_and_windows_paths_keep_backslashes(self):
        env = Path(self.temp.name) / '.env.deploy.local'
        env.write_text('# local settings\nHF_TOKEN="literal=$VALUE`command`"\n'
                       r'FIREBASE_SERVICE_ACCOUNT_FILE="C:\secure\account.json"', encoding='utf-8-sig')
        values = read_deploy_env(env)
        self.assertEqual(values['HF_TOKEN'], 'literal=$VALUE`command`')
        self.assertEqual(values['FIREBASE_SERVICE_ACCOUNT_FILE'], r'C:\secure\account.json')


if __name__ == '__main__':
    unittest.main()
