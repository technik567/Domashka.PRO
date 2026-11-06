"""Same bounded feature policy as the standalone client; never model code."""
import json
from pathlib import Path
POLICY = json.loads((Path(__file__).resolve().parent.parent / 'shared' / 'ai-features.json').read_text(encoding='utf-8'))


def normalize_reasoning(level):
    return level if isinstance(level, str) and level in POLICY['reasoning'] else 'off'


def feature_prompt(reasoning='off', graphics=False):
    level = normalize_reasoning(reasoning)
    result = ('\n' + POLICY['graphicPrompt']) if graphics else ''
    if level != 'off':
        entry = POLICY['reasoning'][level]
        result += f"\nПРОВЕРКА ОТВЕТА · {entry['label']}: {entry['instruction']}\n{POLICY['reasoningSafety']}"
    return result


def gemini_thinking_config(model, level, tutor=False):
    level = normalize_reasoning(level)
    if level == 'off' or model not in ('gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'):
        return {}
    budget = POLICY['reasoning'][level]['budget']
    return {'thinkingConfig': {'thinkingBudget': budget, 'includeThoughts': False},
            'maxOutputTokens': budget + (1500 if tutor else 4096)}
