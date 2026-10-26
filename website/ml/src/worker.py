"""Private JSON-lines adapter. No listening port and no model credentials."""
import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time
import uuid

os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['ANONYMIZED_TELEMETRY'] = 'False'
os.environ.setdefault('HF_HOME', str(Path(os.environ.get('APP_DATA_DIR', '.')) / 'ml' / 'models'))


def emit(value):
    sys.__stdout__.write(json.dumps(value, ensure_ascii=False) + '\n')
    sys.__stdout__.flush()


def analyze(request):
    from src.data_loader import load_business_matrix
    from src.models import ClientProfile
    from src.rule_engine import RuleEngine
    from src.extractor import extract_news_facts
    from src.context_retrieval import retrieve_context
    from src.conclusion_generator import generate_conclusion
    profile = ClientProfile.model_validate(request['profile'])
    text = request['newsText']
    if not isinstance(text, str) or not 1 <= len(text) <= 30000:
        raise ValueError('ML_NEWS_INVALID')
    trace_id = uuid.uuid4().hex
    steps = []
    start = time.monotonic()
    facts = extract_news_facts(text)
    if not isinstance(facts, dict) or not isinstance(facts.get('what_happened'), str):
        raise ValueError('ML_FACTS_INVALID')
    steps.append({'tool': 'ml_extractor', 'stage': 'tool', 'status': 'completed'})
    scoring = RuleEngine(load_business_matrix()).evaluate(text, profile)
    ranking = {'score': scoring.score, 'bucket': scoring.bucket,
               'rules': [m.__dict__ for m in scoring.matches]}
    steps.append({'tool': 'ml_rules', 'stage': 'tool', 'status': 'completed'})
    context = retrieve_context(facts.get('topic', '') + ' ' + text[:700], request['sources'])
    steps.append({'tool': 'ml_rag', 'stage': 'tool', 'status': 'completed' if context['items'] else 'no_verified_material'})
    analysis, check = generate_conclusion(profile, facts, scoring, context,
        grounding={'sources': request['sources'], 'schema': request['schema'],
                   'rules': request['rules'], 'ranking': ranking})
    steps.append({'tool': 'ml_generation', 'stage': 'tool', 'status': 'completed'})
    steps.append({'tool': 'ml_self_check', 'stage': 'tool',
                  'status': 'completed' if check['passed'] else 'issues_found'})
    result = {'analysis': analysis, 'facts': facts, 'ranking': ranking,
              'retrieval': context, 'selfCheck': check, 'workflow': steps, 'traceId': trace_id,
              'durationMs': round((time.monotonic() - start) * 1000)}
    # The website holds the complete trace. The worker stores only operational metadata.
    directory = Path(os.environ['APP_DATA_DIR']) / 'ml' / 'traces'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / (trace_id + '.json')).write_text(json.dumps({
        'traceId': trace_id, 'steps': steps, 'durationMs': result['durationMs'],
        'rules': [m.rule_id for m in scoring.matches],
        'retrievedSourceIds': [x['sourceId'] for x in context['items']],
        'selfCheckPassed': check['passed']}, ensure_ascii=False), encoding='utf-8')
    return result


def main():
    for line in sys.stdin:
        request = json.loads(line)
        try:
            with contextlib.redirect_stdout(sys.stderr):
                if request.get('method') == 'health':
                    result = {'ready': True, 'packages': {name: importlib.metadata.version(name)
                        for name in ['pydantic', 'chromadb', 'sentence-transformers']}}
                else:
                    result = analyze(request['input'])
            emit({'type': 'result', 'id': request['id'], 'result': result})
        except Exception as error:
            # Do not echo prompts, company data, provider responses or environment values.
            code = str(error)
            if not code.startswith(('ML_', 'AI_')) or len(code) > 60:
                code = 'ML_PROCESSING_FAILED'
            emit({'type': 'result', 'id': request['id'], 'error': code})


if __name__ == '__main__':
    main()
