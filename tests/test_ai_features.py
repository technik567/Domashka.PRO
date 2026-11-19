import unittest
from unittest.mock import patch, Mock
from backend import ai_service
from backend.ai_features import feature_prompt, gemini_thinking_config
from scripts.prepare_cloud import public_config

class FeatureTests(unittest.TestCase):
    def test_shared_prompt_contains_real_json_not_escaped_pseudocode(self):
        prompt = feature_prompt('high', True)
        self.assertIn('{"type":"function"', prompt)
        self.assertNotIn('\\"', prompt)
        self.assertIn('не выдавай финальный ответ', prompt)

    def test_bounded_budgets_and_unknown_fallback(self):
        for level,budget in [('low',512),('medium',2048),('high',8192)]:
            self.assertEqual(gemini_thinking_config('gemini-2.5-flash',level)['thinkingConfig'],{'thinkingBudget':budget,'includeThoughts':False})
        self.assertEqual(gemini_thinking_config('unknown','high'),{})
        self.assertEqual(feature_prompt({},False),'')

    def test_gemini_native_body_filters_thought_parts(self):
        response=Mock(status_code=200)
        response.json.return_value={'candidates':[{'content':{'parts':[{'thought':True,'text':'private'},{'text':'Final'}]}}]}
        with patch.object(ai_service.httpx,'post',return_value=response) as post:
            result=ai_service.generate_ai_response('gemini','fixture-only','gemini-2.5-flash','Teacher',[{'role':'user','content':'Question'}],reasoning='high',graphics=True)
        self.assertEqual(result[0],'Final')
        self.assertEqual(post.call_args.kwargs['json']['generationConfig']['thinkingConfig']['thinkingBudget'],8192)

    def test_openrouter_catalog_confirmed_effort_only(self):
        response=Mock(status_code=200)
        response.json.return_value={'choices':[{'message':{'content':'Final'}}]}
        for supported in (False,True):
            with patch.object(ai_service.httpx,'post',return_value=response) as post:
                ai_service.generate_ai_response('openrouter','fixture-only','chosen:free','Teacher',[{'role':'user','content':'Question'}],reasoning='high',reasoning_native=supported)
            payload=post.call_args.kwargs['json']
            self.assertEqual(payload.get('reasoning'),{'effort':'high','exclude':True} if supported else None)

    def test_auto_origin_is_a_public_build_option_not_an_auth_allowlist(self):
        env={'DOMASHKA_SUPABASE_URL':'https://fixture.supabase.co','DOMASHKA_SUPABASE_PUBLISHABLE_KEY':'sb_publishable_fixture_only_12345','DOMASHKA_SITE_URL':'auto'}
        self.assertEqual(public_config(env)['siteUrl'],'auto')
        for site in ('http://example.com','https://localhost','https://github.io'):
            with self.assertRaises(ValueError): public_config({**env,'DOMASHKA_SITE_URL':site})
