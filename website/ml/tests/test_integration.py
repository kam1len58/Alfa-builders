import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.context_retrieval import retrieve_context
from src.conclusion_generator import generate_conclusion


class IntegrationTests(unittest.TestCase):
    def test_unverified_bank_comments_are_not_indexed(self):
        result = retrieve_context('инфляция', [
            {'id': 'bank:fake', 'kind': 'bank', 'verified': False,
             'data': {'text': 'Выдуманная позиция банка'}},
            {'id': 'news:test', 'kind': 'news', 'verified': True,
             'data': {'text': 'Публикация не является позицией банка'}},
        ])
        self.assertEqual(result['items'], [])
        self.assertEqual(result['method'], 'no_verified_material')

    def test_no_model_is_explicitly_not_checked(self):
        with patch.dict('os.environ', {'ML_NODE_TRANSPORT': '0'}):
            conclusion, check = generate_conclusion(None, {}, None, '')
        self.assertFalse(check['passed'])
        self.assertEqual(conclusion['actions'], [])

    def test_grounded_route_preserves_verification_result(self):
        with patch('src.grounded.generate_grounded', return_value=({'summary': 'test'},
                  {'passed': False, 'issues': ['unsupported fact']})) as generate:
            result, check = generate_conclusion(None, {}, None, {},
                grounding={'sources': [], 'schema': {}, 'rules': 'rules', 'ranking': {}})
        self.assertEqual(result['summary'], 'test')
        self.assertFalse(check['passed'])
        generate.assert_called_once()


if __name__ == '__main__':
    unittest.main()
