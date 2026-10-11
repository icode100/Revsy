"""Source-key joining, complete GATE coverage and resumable parsing without API calls."""

import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for directory in (ROOT / '.test-deps', ROOT / 'services/quiz-parser', ROOT / 'services/quiz-gemini'):
    sys.path.insert(0, str(directory))

from quiz_parser.domain import InvalidImport
from quiz_gemini import pipeline
from quiz_gemini.provider import GeminiClient
from quiz_gemini.worker import GeminiWorker


def question(number=1, *, session='1', section='GENERAL', kind='mcq', page=1):
    return {'session': session, 'section': section, 'number': number,
        'problem': f'Question {number}: solve $x^2 = 4$.',
        'options': [] if kind == 'nat' else ['First', 'Second', 'Third', 'Fourth'],
        'startPage': page, 'endPage': page}


def key(number=1, *, session='1', section='GENERAL', kind='mcq', answer=None, marks=1, page=1):
    answer = answer if answer is not None else {'mcq': 'C OR D', 'msq': 'A; C', 'nat': '0.1 to 0.3'}[kind]
    return {'session': session, 'section': section, 'number': number, 'kind': kind,
        'answer': answer, 'marks': marks, 'page': page,
        'sourceText': f'{number} {kind.upper()} {answer} {marks}'}


def sample():
    kinds = ['mcq', 'msq', 'nat']
    return {'question': [question(i, kind=kind) for i, kind in enumerate(kinds, 1)]}, {
        'key': [key(i, kind=kind, marks=1 if i == 1 else 2) for i, kind in enumerate(kinds, 1)]}


def full_gate(sessions=1):
    questions, keys = [], []
    for session in range(1, sessions + 1):
        for section, count in (('GA', 10), ('CS', 55)):
            for number in range(1, count + 1):
                kind = ['mcq', 'msq', 'nat'][number % 3]
                questions.append(question(number, session=str(session), section=section, kind=kind))
                keys.append(key(number, session=str(session), section=section, kind=kind))
    return {'question': questions}, {'key': keys}


class AnswerKeyTests(unittest.TestCase):
    def test_literal_mcq_alternatives_msq_sets_and_numeric_ranges(self):
        expected = [
            ('mcq', 'C OR D', 4, {'acceptedOptionIndices': [2, 3]}),
            ('mcq', 'B', 4, {'acceptedOptionIndices': [1]}),
            ('msq', 'C; A', 4, {'correctOptionIndices': [0, 2]}),
            ('msq', 'a, c', 4, {'correctOptionIndices': [0, 2]}),
            ('nat', '-0.3 to -0.1', 0, {'minValue': '-0.3', 'maxValue': '-0.1'}),
            ('nat', '2.5e-3', 0, {'minValue': '2.5e-3', 'maxValue': '2.5e-3'}),
            ('nat', '1 – 2', 0, {'minValue': '1', 'maxValue': '2'}),
        ]
        for kind, answer, option_count, fields in expected:
            with self.subTest(kind=kind, answer=answer):
                self.assertEqual(pipeline.answer_entry(key(kind=kind, answer=answer), 'q1', option_count),
                    {'questionId': 'q1', 'kind': kind, **fields})

    def test_answers_require_complete_literal_evidence_not_substrings(self):
        rows = [
            {**key(answer='A'), 'sourceText': '1 MCQ B 1 GA'},
            {**key(3, kind='nat', answer='0.3'), 'sourceText': '3 NAT 0.35 2'},
            {**key(kind='msq', answer='A; C'), 'sourceText': '1 MSQ A; C; D 1'},
            {**key(answer='C OR D'), 'sourceText': '1 MCQ C OR D OR B 1'},
            {**key(answer='C'), 'sourceText': '21 MCQ C 2'},
            {**key(answer='C'), 'sourceText': '1 MCQ B 1'},
        ]
        for row in rows:
            with self.subTest(row=row), self.assertRaises(InvalidImport):
                pipeline.answer_entry(row, 'q1', 0 if row['kind'] == 'nat' else 4)

    def test_missing_source_and_ambiguous_keys_are_rejected(self):
        cases = [('mcq', 'C; D', 4), ('mcq', 'C OR C', 4), ('mcq', 'E', 4),
            ('msq', 'A OR C', 4), ('msq', 'A; A', 4), ('msq', 'A; E', 4),
            ('nat', '0.3 to 0.1', 0), ('nat', 'NaN', 0), ('nat', 'Infinity', 0),
            ('nat', '0x10', 0), ('nat', '1e99', 0), ('nat', '1/2', 0), ('nat', '1', 2)]
        for kind, answer, options in cases:
            with self.subTest(kind=kind, answer=answer), self.assertRaises(InvalidImport):
                pipeline.answer_entry(key(kind=kind, answer=answer), 'q1', options)
        for source in ('', None):
            with self.assertRaises(InvalidImport):
                pipeline.answer_entry({**key(), 'sourceText': source}, 'q1', 4)

    def test_supplied_numeric_alternatives_preserve_each_disjoint_accepted_range(self):
        entry = pipeline.answer_entry(key(23, kind='nat', answer='819 to 820 OR 205 to 205'), 's1-cs-q23', 0)
        self.assertEqual(entry, {'questionId': 's1-cs-q23', 'kind': 'nat',
            'minValue': '819', 'maxValue': '820',
            'additionalRanges': [{'minValue': '205', 'maxValue': '205'}]})
        entry = pipeline.answer_entry(key(kind='nat', answer='-1 OR 0.1 to 0.2 OR 5e-1'), 'q1', 0)
        self.assertEqual(entry['additionalRanges'], [
            {'minValue': '0.1', 'maxValue': '0.2'}, {'minValue': '5e-1', 'maxValue': '5e-1'}])
        questions, keys = sample()
        keys['key'][2] = key(3, kind='nat', answer='819 to 820 OR 205 to 205', marks=2)
        self.assertEqual(pipeline.prepare_questions(questions, keys, paper_pages=1, key_pages=1)[2][1]['additionalRanges'],
            [{'minValue': '205', 'maxValue': '205'}])

    def test_numeric_alternatives_require_complete_evidence_and_bounded_unique_ranges(self):
        for answer in ('1 OR 1.0', '-0 OR +0', '1 to 2 OR 2 to 1', '1 OR NaN',
                       ' OR 1', '1 OR ', ' OR '.join(str(i) for i in range(9))):
            with self.subTest(answer=answer), self.assertRaises(InvalidImport):
                pipeline.answer_entry(key(kind='nat', answer=answer), 'q1', 0)
        row = key(kind='nat', answer='819 to 820')
        row['sourceText'] = '1 NAT 819 to 820 OR 205 to 205 2'
        with self.assertRaises(InvalidImport):
            pipeline.answer_entry(row, 'q1', 0)


class PreparationTests(unittest.TestCase):
    def prepare(self, questions, keys):
        return pipeline.prepare_questions(questions, keys, paper_pages=200, key_pages=30)

    def test_questions_match_key_by_identity_not_array_position(self):
        questions, keys = sample()
        keys['key'].reverse()
        prepared = self.prepare(questions, keys)
        self.assertEqual([item[0]['kind'] for item in prepared], ['mcq', 'msq', 'nat'])
        self.assertEqual([item[0]['marks'] for item in prepared], [1, 2, 2])
        self.assertEqual([item[0]['id'] for item in prepared], ['s1-general-q1', 's1-general-q2', 's1-general-q3'])
        self.assertEqual(prepared[0][1]['acceptedOptionIndices'], [2, 3])
        self.assertEqual(prepared[1][1]['correctOptionIndices'], [0, 2])
        self.assertEqual(prepared[2][1]['minValue'], '0.1')
        self.assertEqual(prepared[2][2], [1])

    def test_diagram_options_discard_interpretations_without_changing_printed_text_options(self):
        questions, keys = sample()
        options = ['Concave (the correct answer)', '$x^2 + 1$ units',
            'Convex shape pointing right, so select C', 'printf("A");']
        questions['question'][0].update(options=options.copy(), imageOptionIndices=[0, 2])
        record, answer, _ = self.prepare(questions, keys)[0]
        self.assertEqual(record['options'], [
            'See option A in the original question page.', '$x^2 + 1$ units',
            'See option C in the original question page.', 'printf("A");'])
        self.assertNotIn('Concave', str(record))
        self.assertNotIn('Convex', str(record))
        self.assertNotIn('correct answer', str(record))
        self.assertEqual(questions['question'][0]['options'], options)
        self.assertEqual(answer['acceptedOptionIndices'], [2, 3])

    def test_unflagged_printed_options_and_legacy_checkpoints_keep_their_exact_content(self):
        for image_indices in (None, []):
            questions, keys = sample()
            options = ['Concave', 'Convex', '$\\frac{1}{2}$', 'First line\nSecond line']
            questions['question'][0]['options'] = options.copy()
            if image_indices is not None:
                questions['question'][0]['imageOptionIndices'] = image_indices
            self.assertEqual(self.prepare(questions, keys)[0][0]['options'], options)

    def test_malformed_diagram_option_indices_fail_with_safe_import_errors(self):
        malformed = (None, {}, '0', [-1], [4], [8], [0, 0], [True], [0.0],
                     ['0'], [[]], [{}], [float('nan')])
        for image_indices in malformed:
            questions, keys = sample()
            questions['question'][0]['imageOptionIndices'] = image_indices
            with self.subTest(indices=image_indices), self.assertRaisesRegex(
                    InvalidImport, '^The original diagram options could not be identified\\.$'):
                self.prepare(questions, keys)
        questions, keys = sample()
        questions['question'][2]['imageOptionIndices'] = [0]
        with self.assertRaisesRegex(InvalidImport, 'original diagram options'):
            self.prepare(questions, keys)
        questions, keys = sample()
        questions['question'][0].update(options=[str(i) for i in range(8)], imageOptionIndices=[7])
        self.assertEqual(self.prepare(questions, keys)[0][0]['options'][7],
                         'See option H in the original question page.')

    def test_full_merged_gate_sessions_have_distinct_restarted_numbers(self):
        questions, keys = full_gate(sessions=2)
        prepared = self.prepare(questions, keys)
        self.assertEqual(len(prepared), 130)
        self.assertEqual(len({item[0]['id'] for item in prepared}), 130)
        self.assertEqual(prepared[0][0]['id'], 's1-ga-q1')
        self.assertEqual(prepared[65][0]['id'], 's2-ga-q1')
        self.assertEqual(prepared[-1][0]['id'], 's2-cs-q55')

    def test_full_gate_coverage_rejects_missing_rows_even_if_both_extractions_agree(self):
        for omit in (lambda row: row['section'] == 'GA',
                     lambda row: row['section'] == 'CS',
                     lambda row: row['section'] == 'CS' and row['number'] == 55,
                     lambda row: row['section'] == 'GA' and row['number'] == 5):
            questions, keys = full_gate()
            questions['question'] = [row for row in questions['question'] if not omit(row)]
            keys['key'] = [row for row in keys['key'] if not omit(row)]
            with self.assertRaisesRegex(InvalidImport, 'GATE|missing'):
                self.prepare(questions, keys)

    def test_duplicate_unknown_or_cross_session_keys_cannot_grade_another_question(self):
        for mutate in (
            lambda q, k: k['key'].__setitem__(1, copy.deepcopy(k['key'][0])),
            lambda q, k: q['question'].__setitem__(1, copy.deepcopy(q['question'][0])),
            lambda q, k: k['key'][0].__setitem__('session', '2'),
            lambda q, k: k['key'][0].__setitem__('section', 'OTHER'),
            lambda q, k: k['key'][0].__setitem__('number', 4),
            lambda q, k: k['key'].pop(),
        ):
            questions, keys = sample(); mutate(questions, keys)
            with self.assertRaises(InvalidImport):
                self.prepare(questions, keys)

    def test_identities_are_bounded_and_booleans_are_not_question_numbers(self):
        for field, value in (('session', '0'), ('session', '01'), ('session', 'SESSION-1'),
            ('session', '100'), ('section', '../CS'), ('section', ''), ('number', True),
            ('number', 0), ('number', 201), ('number', 1.0), ('number', '1')):
            questions, keys = sample(); questions['question'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(InvalidImport):
                self.prepare(questions, keys)

    def test_page_and_mark_constraints_reject_uncertain_source_locations(self):
        for field, value in (('startPage', 0), ('endPage', 201), ('startPage', True),
                             ('endPage', 0), ('endPage', 4)):
            questions, keys = sample(); questions['question'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(InvalidImport):
                self.prepare(questions, keys)
        for field, value in (('page', 0), ('page', 31), ('page', True), ('marks', True),
                             ('marks', 3), ('marks', 1.0), ('marks', '1')):
            questions, keys = sample(); keys['key'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(InvalidImport):
                self.prepare(questions, keys)
        questions, keys = sample()
        questions['question'][0].update(startPage=198, endPage=200)
        self.assertEqual(self.prepare(questions, keys)[0][2], [198, 199, 200])

    def test_empty_or_malformed_questions_keys_and_options_fail_closed(self):
        for mutate in (
            lambda q, k: q.__setitem__('question', []),
            lambda q, k: q.__setitem__('question', 'bad'),
            lambda q, k: q['question'].__setitem__(0, 'bad'),
            lambda q, k: k.__setitem__('key', 'bad'),
            lambda q, k: k['key'].__setitem__(0, 'bad'),
            lambda q, k: q['question'][0].__setitem__('problem', ''),
            lambda q, k: q['question'][0].__setitem__('options', []),
            lambda q, k: q['question'][0].__setitem__('options', ['A'] * 9),
            lambda q, k: q['question'][0].__setitem__('options', [None, 'B']),
            lambda q, k: q['question'][2].__setitem__('options', ['A', 'B']),
            lambda q, k: k['key'][0].__setitem__('kind', 'essay'),
        ):
            questions, keys = sample(); mutate(questions, keys)
            with self.assertRaises(InvalidImport):
                self.prepare(questions, keys)


JOB_ID = '11111111-1111-4111-8111-111111111111'
PREFIX = f'users/alice/quiz-imports/{JOB_ID}/'


def job(separate=True):
    return {'uid': 'alice', 'id': JOB_ID, 'title': 'GATE CS', 'leaseToken': 'lease1',
        'paperPath': PREFIX + 'paper.pdf', **({'answerKeyPath': PREFIX + 'answer-key.pdf'} if separate else {})}


class FakeStore:
    def __init__(self):
        self.updates, self.loads, self.images, self.checkpoints = [], [], [], {}

    def owned_update(self, job, fields, **kwargs):
        self.updates.append(copy.deepcopy(fields))

    def load_pdf(self, path):
        self.loads.append(path)
        return (b'%PDF-key' if path.endswith('answer-key.pdf') else b'%PDF-paper'), {}

    def load_checkpoint(self, job, name):
        return self.checkpoints.get(name)

    def save_checkpoint(self, job, name, value):
        self.checkpoints[name] = copy.deepcopy(value)

    def save_image(self, job, asset_id, content, page):
        self.images.append((asset_id, content, page))
        return {'id': asset_id, 'page': page, 'storagePath': PREFIX + f'assets/lease1/{asset_id}.png'}


class FakeModels:
    model = 'gemini-unit-test'

    def __init__(self):
        self.uploads, self.extractions, self.deletions = [], [], []
        self.questions, self.keys = sample()

    def upload(self, data, label):
        uploaded = {'name': f'files/mock{len(self.uploads)}', 'uri': f'mock://{label}'}
        self.uploads.append((data, label, uploaded))
        return uploaded

    def check_budget(self):
        pass

    def extract(self, uploaded, prompt, schema, **kwargs):
        self.extractions.append((uploaded, prompt, schema, kwargs))
        return copy.deepcopy(self.keys if 'key' in schema['properties'] else self.questions), {'totalTokenCount': 10}

    def delete(self, uploaded):
        self.deletions.append(uploaded)


class FakePages:
    def __init__(self, data):
        self.closed = False
        self.calls = []

    def image(self, page):
        self.calls.append(page)
        return b'original-source-page-pixels'

    def close(self):
        self.closed = True


class PipelineTests(unittest.TestCase):
    def run_job(self, store, models, item=None):
        source = FakePages(b'pdf')
        with patch.object(pipeline, 'validated_pdf', return_value=1) as validated, patch.object(
                pipeline, 'OriginalPages', return_value=source):
            draft = pipeline.parse_gemini_job(store, models, item or job())
        return draft, source, validated

    def test_separate_pdf_pipeline_preserves_source_pages_and_deletes_temporary_uploads(self):
        store, models = FakeStore(), FakeModels()
        draft, source, validated = self.run_job(store, models)
        self.assertEqual(draft['schemaVersion'], 2)
        self.assertEqual(len(draft['question']), 3)
        self.assertEqual(draft['source'], {'paperPath': PREFIX + 'paper.pdf', 'answerKeyPath': PREFIX + 'answer-key.pdf'})
        self.assertEqual(len(models.uploads), 2)
        self.assertEqual(models.deletions, [item[2] for item in models.uploads])
        self.assertEqual(models.extractions[0][3], {'output_tokens': 16384})
        self.assertEqual(len(store.images), 1)
        self.assertEqual(source.calls, [0])
        self.assertTrue(source.closed)
        self.assertTrue(all(q['images'][0]['id'] == 'source-p1' for q in draft['question']))
        self.assertEqual([call.kwargs['max_pages'] for call in validated.call_args_list], [200, 30])
        self.assertEqual(set(store.checkpoints), {'key', 'question'})

    def test_final_draft_preserves_original_diagram_pixels_and_neutral_option_references(self):
        store, models = FakeStore(), FakeModels()
        models.questions['question'][0].update(
            options=['Concave (correct)', 'Printed option B', 'Convex (incorrect)', 'Printed option D'],
            imageOptionIndices=[0, 2])
        draft, source, _ = self.run_job(store, models)
        self.assertEqual(draft['question'][0]['options'], [
            'See option A in the original question page.', 'Printed option B',
            'See option C in the original question page.', 'Printed option D'])
        self.assertNotIn('Concave', str(draft))
        self.assertNotIn('Convex', str(draft))
        self.assertEqual(store.images, [('source-p1', b'original-source-page-pixels', 1)])
        self.assertEqual(draft['question'][0]['images'], [
            {'id': 'source-p1', 'page': 1, 'storagePath': PREFIX + 'assets/lease1/source-p1.png'}])
        self.assertEqual(draft['key'][0]['acceptedOptionIndices'], [2, 3])
        self.assertTrue(source.closed)

    def test_embedded_key_reuses_one_temporary_uploaded_paper(self):
        store, models = FakeStore(), FakeModels()
        draft, _, validated = self.run_job(store, models, job(separate=False))
        self.assertEqual(len(models.uploads), 1)
        self.assertEqual(len(models.extractions), 2)
        self.assertIs(models.extractions[0][0], models.extractions[1][0])
        self.assertEqual(len(models.deletions), 1)
        self.assertNotIn('answerKeyPath', draft['source'])
        self.assertEqual(validated.call_count, 1)

    def test_completed_checkpoints_resume_without_inference_or_pdf_upload(self):
        store, models = FakeStore(), FakeModels()
        first, _, _ = self.run_job(store, models)
        fresh = FakeModels()
        resumed, _, _ = self.run_job(store, fresh)
        self.assertEqual(resumed, first)
        self.assertEqual(fresh.uploads, [])
        self.assertEqual(fresh.extractions, [])
        self.assertEqual(fresh.deletions, [])

    def test_key_checkpoint_resumes_only_question_phase_and_rejects_model_changes(self):
        store, models = FakeStore(), FakeModels()
        store.checkpoints['key'] = {'schemaVersion': 1, 'value': models.keys,
            'usage': {'totalTokenCount': 10}, 'model': models.model}
        self.run_job(store, models, job(separate=False))
        self.assertEqual(len(models.uploads), 1)
        self.assertEqual(len(models.extractions), 1)
        self.assertIn('question', models.extractions[0][2]['properties'])
        different = FakeModels(); different.model = 'another-model'
        with self.assertRaisesRegex(InvalidImport, 'another model'):
            self.run_job(store, different)
        self.assertEqual(different.uploads, [])

    def test_incomplete_key_does_not_save_assets_and_always_cleans_up(self):
        store, models = FakeStore(), FakeModels()
        models.keys['key'].pop()
        with self.assertRaisesRegex(InvalidImport, 'cover every'):
            self.run_job(store, models)
        self.assertEqual(store.images, [])
        self.assertEqual(models.deletions, [item[2] for item in models.uploads])

    def test_unowned_paths_reject_before_storage_or_provider_access(self):
        store, models = FakeStore(), FakeModels()
        unowned = {**job(), 'paperPath': PREFIX.replace('alice', 'bob') + 'paper.pdf'}
        with self.assertRaises(InvalidImport):
            self.run_job(store, models, unowned)
        self.assertEqual(store.loads, [])
        self.assertEqual(models.uploads, [])

    def test_storage_failure_closes_pdf_renderer_and_deletes_uploaded_files(self):
        store, models = FakeStore(), FakeModels()
        source = FakePages(b'pdf')
        with patch.object(pipeline, 'validated_pdf', return_value=1), patch.object(
                pipeline, 'OriginalPages', return_value=source), patch.object(
                store, 'save_image', side_effect=InvalidImport('Owned image upload failed')):
            with self.assertRaisesRegex(InvalidImport, 'Owned image'):
                pipeline.parse_gemini_job(store, models, job())
        self.assertTrue(source.closed)
        self.assertEqual(models.deletions, [item[2] for item in models.uploads])

    def test_expired_budget_rejects_before_intake_or_new_paid_phase(self):
        store, models = FakeStore(), FakeModels()
        with patch.object(models, 'check_budget', side_effect=InvalidImport('Parsing time limit reached')):
            with self.assertRaisesRegex(InvalidImport, 'time limit'):
                self.run_job(store, models)
        self.assertEqual(store.loads, [])
        self.assertEqual(store.updates, [])
        self.assertEqual(models.uploads, [])

    def test_budget_expiry_after_page_render_does_not_upload_image_and_always_closes_renderer(self):
        store, models = FakeStore(), FakeModels()
        source = FakePages(b'pdf')
        expired = [False]
        def render(page):
            expired[0] = True
            return b'original pixels'
        def check():
            if expired[0]:
                raise InvalidImport('Parsing time limit reached')
        with patch.object(models, 'check_budget', side_effect=check), patch.object(
                pipeline, 'validated_pdf', return_value=1), patch.object(
                pipeline, 'OriginalPages', return_value=source), patch.object(source, 'image', side_effect=render):
            with self.assertRaisesRegex(InvalidImport, 'time limit'):
                pipeline.parse_gemini_job(store, models, job())
        self.assertEqual(store.images, [])
        self.assertTrue(source.closed)
        self.assertEqual(models.deletions, [item[2] for item in models.uploads])


class WorkerDeadlineTests(unittest.TestCase):
    def test_worker_scopes_processing_to_1680_seconds_and_persists_safe_deadline_failure(self):
        import httpx
        store = FakeStore()
        models = GeminiClient('dummy-unit-test-key', client=httpx.Client(
            transport=httpx.MockTransport(lambda request: self.fail('No network expected'))))
        self.addCleanup(models.close)
        clock = [100.0]
        def parse(*args):
            self.assertEqual(models._remaining(10000), 1680)
            clock[0] += 1680
            models.check_budget()
        with patch('quiz_gemini.provider.time.monotonic', side_effect=lambda: clock[0]), patch(
                'quiz_gemini.worker.Heartbeat') as heartbeat, patch(
                'quiz_gemini.worker.parse_gemini_job', side_effect=parse):
            heartbeat.return_value.lost = False
            GeminiWorker(store, models).process(job())
            models.check_budget()
        self.assertEqual(store.updates[-1]['status'], 'failed')
        self.assertIn('time limit', store.updates[-1]['error'])
        self.assertNotIn('dummy-unit-test-key', store.updates[-1]['error'])
        self.assertFalse(any(update.get('status') == 'ready' for update in store.updates))


if __name__ == '__main__':
    unittest.main()
