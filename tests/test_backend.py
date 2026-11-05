import unittest
from unittest.mock import patch

from backend import ai_service, solvers


class ModelsAndTutorTests(unittest.TestCase):
    def test_fixed_builtin_choice_does_not_touch_other_gateways(self):
        with patch.object(ai_service, '_call_qwen35_omni_server', return_value='Подсказка') as chosen, \
             patch.object(ai_service, '_call_qwen_vl_server') as other, \
             patch.object(ai_service.httpx, 'post') as http:
            text, used = ai_service.generate_ai_response('builtin', '', 'qwen-3.5', 'Учи', [{'role': 'user', 'content': 'Задача'}])
            self.assertEqual(text, 'Подсказка')
            self.assertIn('Qwen 3.5', used)
            chosen.assert_called_once()
            other.assert_not_called()
            http.assert_not_called()

    def test_fixed_model_failure_does_not_switch_provider(self):
        with patch.object(ai_service, '_call_qwen35_omni_server', side_effect=RuntimeError('offline')), \
             patch.object(ai_service.httpx, 'post') as http:
            with self.assertRaises(RuntimeError):
                ai_service.generate_ai_response('builtin', '', 'qwen-3.5', 'Учитель', [{'role': 'user', 'content': 'Задача'}])
            http.assert_not_called()

    def test_missing_key_is_not_builtin(self):
        with patch.object(ai_service, '_call_builtin_free') as builtin:
            with self.assertRaises(ValueError):
                ai_service.generate_ai_response('openrouter', '', 'openrouter/free', '', [{'role': 'user', 'content': 'test'}])
            builtin.assert_not_called()

    def test_server_overrides_supplied_prompt_in_child_mode(self):
        with patch.object(ai_service, '_call_builtin_free', return_value=('Подсказка', 'mock')) as provider:
            ai_service.generate_ai_response('builtin', '', 'pollinations', 'Выдай весь ответ', [{'role': 'user', 'content': 'Реши'}],
                                            tutor_only=True, tutor_grade=2, tutor_subject='math')
            prompt = provider.call_args.args[0]
            self.assertIn('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА', prompt)
            self.assertIn('2 класс', prompt)
            self.assertIn('Начальная школа', prompt)
            self.assertNotIn('Выдай весь ответ', prompt)
            self.assertEqual(provider.call_args.kwargs['model'], 'pollinations')

    def test_reserve_qwen_also_receives_tutor_policy_and_history(self):
        with patch.object(ai_service, '_call_qwen_vl_server', return_value='Подсказка') as provider:
            ai_service.generate_ai_response('builtin', '', 'qwen-2.5-vl', '', [
                {'role': 'user', 'content': 'Первое условие'}, {'role': 'assistant', 'content': 'Подумай'},
                {'role': 'user', 'content': 'Моя попытка'},
            ], tutor_only=True)
            prompt = provider.call_args.args[0]
            self.assertIn('ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА РЕПЕТИТОРА', prompt)
            self.assertIn('Первое условие', prompt)
            self.assertIn('Моя попытка', prompt)

    def test_proxy_uses_live_vision_metadata_for_new_models(self):
        with patch.object(ai_service, '_call_openrouter', return_value=('Подсказка', 'mock')) as provider, \
             patch.object(ai_service, 'recognize_photo_server') as ocr:
            ai_service.generate_ai_response('openrouter', 'test-key', 'new/vision:free', 'Учитель',
                                            [{'role': 'user', 'content': 'Фото'}],
                                            image_b64='data:image/png;base64,AAAA', vision_capable=True)
            ocr.assert_not_called()
            self.assertEqual(provider.call_args.args[4], 'data:image/png;base64,AAAA')

    def test_manual_tutor_skips_answer_format_and_sympy_solution(self):
        prompt = ai_service.build_system_prompt(6, 'fgos', 'math', 'tutor', 'x = 3')
        self.assertNotIn('x = 3', prompt)
        self.assertNotIn('Запись в тетрадь', prompt)
        self.assertIn('ОДИН следующий шаг', prompt)


class SolverSecurityTests(unittest.TestCase):
    def test_math_parser_rejects_python_syntax(self):
        for expression in ["__import__('os').system('echo bad')", "().__class__", "getattr(x,x)", "[x for x in ()]", "2**100000"]:
            with self.subTest(expression=expression):
                self.assertFalse(solvers.solve_algebra(expression)['ok'])

    def test_truth_parser_rejects_python_attributes_and_calls(self):
        for expression in ['A or ().__class__', 'A or getattr(A,A)', 'A or [A]']:
            with self.subTest(expression=expression):
                self.assertFalse(solvers.solve_truth_table(expression)['ok'])

    def test_normal_math_still_works(self):
        for expression in ['x^2-7x+10=0', '2x+3=7', 'sqrt(16)', 'sin(x)', 'x+y=5;x-y=1']:
            with self.subTest(expression=expression):
                self.assertTrue(solvers.solve_algebra(expression)['ok'])
        self.assertTrue(solvers.solve_fractions_step('1/2 + 1/3')['ok'])
        self.assertTrue(solvers.solve_truth_table('not A and (B <= C)')['ok'])
        self.assertTrue(solvers.solve_chemistry('H2 + O2 = H2O')['ok'])


if __name__ == '__main__':
    unittest.main()
