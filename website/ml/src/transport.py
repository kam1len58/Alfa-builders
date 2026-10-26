"""Model calls are delegated to Node, where the key, limits and usage accounting live."""
import json
import os
import sys
import uuid
from types import SimpleNamespace


def complete_json(model, system, data, max_tokens=5200):
    if os.getenv('ML_NODE_TRANSPORT') != '1':
        raise RuntimeError('ML_NODE_TRANSPORT_REQUIRED')
    call_id = uuid.uuid4().hex
    message = {'type': 'model', 'id': call_id, 'model': model,
               'system': system, 'data': data, 'maxTokens': max_tokens}
    sys.__stdout__.write(json.dumps(message, ensure_ascii=False) + '\n')
    sys.__stdout__.flush()
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError('ML_PARENT_CLOSED')
    reply = json.loads(line)
    if reply.get('type') != 'model_result' or reply.get('id') != call_id:
        raise RuntimeError('ML_PROTOCOL_ERROR')
    if reply.get('error'):
        raise RuntimeError(reply['error'])
    return reply['result']


class Completions:
    @staticmethod
    def create(model, messages, **kwargs):
        system = '\n'.join(m['content'] for m in messages if m['role'] == 'system')
        data = [m for m in messages if m['role'] != 'system']
        result = complete_json(model, system, data, kwargs.get('max_tokens', 1800))
        return SimpleNamespace(choices=[SimpleNamespace(
            message=SimpleNamespace(content=json.dumps(result, ensure_ascii=False)))])


client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
