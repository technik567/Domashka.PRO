import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const state=vi.hoisted(()=>({cfg:{url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture1234567890',siteUrl:'https://site.workers.dev/',captchaSiteKey:'public-fixture-key'},client:{auth:{signInWithPassword:vi.fn(),signUp:vi.fn(),resetPasswordForEmail:vi.fn()},functions:{invoke:vi.fn()}},runtime:{backupStatus:vi.fn(),replaceBackupCodes:vi.fn()}}));
vi.mock('../src/cloud/client',async importOriginal=>({...await importOriginal(),getCloudConfig:()=>state.cfg,getCloudClient:()=>state.client}));
vi.mock('../src/cloud/bridge',()=>({cloud:()=>state.runtime}));
vi.mock('../src/components/GuidedTour',()=>({default:()=>null}));
vi.mock('../src/components/SiteAssistant',()=>({default:()=>null}));
import { CloudLogin } from '../src/components/CloudAccess';
import BackupCodes from '../src/components/BackupCodes';
import CloudRecoverySettings from '../src/components/CloudRecoverySettings';
import { accountAccess, parentUsername, checkNewPassword, normalizeBackupCode } from '../src/cloud/accountAccess';
import { redactHelpInput } from '../src/standalone/helpKnowledge';
const codes=Array.from({length:10},(_,i)=>(i+1).toString(16).padStart(32,'0').toUpperCase().match(/.{8}/g).join('-'));
const issued={ok:true,login:'parent_one',codes,remaining:10};
beforeEach(()=>{
  cleanup();vi.clearAllMocks();localStorage.clear();sessionStorage.clear();state.cfg.captchaSiteKey='public-fixture-key';
  window.turnstile={render:vi.fn((_node,opts)=>{opts.callback('captcha-fixture');return 'widget';}),remove:vi.fn()};
  state.client.functions.invoke.mockResolvedValue({data:issued,error:null});
  state.runtime.backupStatus.mockResolvedValue({remaining:7,total:10});state.runtime.replaceBackupCodes.mockResolvedValue(issued);
});
async function registerForm() {
  render(<CloudLogin />);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Я родитель: регистрация'}));
  await user.type(screen.getByLabelText('Логин родителя'),'Parent_One');await user.type(screen.getByLabelText('Имя родителя'),'Родитель');
  await user.type(screen.getByLabelText('Новый пароль'),'Fixture-password-123');await user.type(screen.getByLabelText('Повторите пароль'),'Fixture-password-123');
  const question=screen.getByLabelText('Ответ на вопрос для родителя');const square=Number(question.parentElement.textContent.match(/√(\d+)/)[1]);await user.type(question,String(Math.sqrt(square)));
  await user.click(screen.getByRole('checkbox'));await waitFor(()=>expect(window.turnstile.render).toHaveBeenCalled());
  return user;
}
describe('username and recovery input contracts',()=>{
  it('normalizes usernames without accepting internal addresses or child logins for parent registration',()=>{
    expect(parentUsername(' Parent_ONE ')).toBe('parent_one');for(const bad of ['ab','a@parents.domashka.invalid','child.123456abcdef','русский','a'.repeat(25)]) expect(()=>parentUsername(bad)).toThrow();
  });
  it('accepts one full code with case/spacing normalization, not partial codes',()=>{
    expect(normalizeBackupCode(codes[0].toLowerCase().replaceAll('-',' '))).toBe(codes[0].replaceAll('-',''));
    expect(()=>normalizeBackupCode('123456')).toThrow();expect(()=>normalizeBackupCode(codes[0]+'X')).toThrow();
  });
  it('enforces the password confirmation and Auth byte limit',()=>{
    expect(()=>checkNewPassword('Good-fixture-123','different')).toThrow();expect(()=>checkNewPassword('я'.repeat(37))).toThrow(/72/);expect(()=>checkNewPassword('a'.repeat(72))).not.toThrow();
  });
  it('never retries an ambiguous mutation and explains recovery after a lost response',async()=>{
    state.client.functions.invoke.mockRejectedValueOnce(new Error('network'));await expect(accountAccess({action:'recover'},state.client)).rejects.toThrow(/сначала проверьте вход/i);expect(state.client.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('refuses incomplete/duplicate returned code sets',async()=>{
    state.client.functions.invoke.mockResolvedValueOnce({data:{...issued,codes:Array(10).fill(codes[0])},error:null});await expect(accountAccess({action:'register'},state.client)).rejects.toThrow(/10 кодов/);
  });
  it('redacts formatted and unformatted backup codes before help prompts',()=>{
    expect(redactHelpInput(`Код ${codes[1]}`)).toContain('[резервный код скрыт]');expect(redactHelpInput(codes[2].replaceAll('-',''))).not.toContain(codes[2].replaceAll('-',''));
  });
});
describe('registration displays all ten codes',()=>{
  it('registers without email, shows all ten together, and requires explicit save acknowledgement',async()=>{
    const user=await registerForm();await user.click(screen.getByRole('button',{name:'Зарегистрироваться'}));
    const panel=await screen.findByRole('region',{name:'10 резервных кодов'});expect(within(panel).getAllByRole('listitem')).toHaveLength(10);codes.forEach(c=>expect(within(panel).getByText(c)).toBeTruthy());
    expect(state.client.functions.invoke).toHaveBeenCalledWith('account-access',expect.objectContaining({body:expect.objectContaining({action:'register',login:'parent_one',password:'Fixture-password-123',captchaToken:'captcha-fixture'})}));
    expect(state.client.auth.signUp).not.toHaveBeenCalled();expect(state.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Новый пароль')).toBeNull();expect(screen.getByRole('button',{name:/перейти ко входу/}).disabled).toBe(true);
    expect(JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+location.href).not.toContain(codes[0]);
    await user.click(within(panel).getByRole('checkbox'));await user.click(screen.getByRole('button',{name:/перейти ко входу/}));
    expect(screen.queryByText(codes[0])).toBeNull();expect(screen.getByLabelText('Логин родителя или полный логин ребёнка').value).toBe('parent_one');
  });
  it('does not open public registration when the site key is missing',async()=>{
    state.cfg.captchaSiteKey='';render(<CloudLogin />);fireEvent.click(screen.getByRole('button',{name:'Я родитель: регистрация'}));expect(screen.getByRole('button',{name:'Зарегистрироваться'}).disabled).toBe(true);expect(screen.getByText(/SMTP не нужен/)).toBeTruthy();expect(state.client.functions.invoke).not.toHaveBeenCalled();
  });
  it('uses one code and reports the remaining nine, without generating a new set',async()=>{
    state.client.functions.invoke.mockResolvedValueOnce({data:{ok:true,remaining:9},error:null});render(<CloudLogin />);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Забыли пароль?'}));
    await user.type(screen.getByLabelText('Логин родителя'),'parent_one');await user.type(screen.getByLabelText('Одноразовый резервный код'),codes[0]);await user.type(screen.getByLabelText('Новый пароль'),'New-fixture-123');await user.type(screen.getByLabelText('Повторите пароль'),'New-fixture-123');await user.click(screen.getByRole('button',{name:'Восстановить по коду'}));
    expect(await screen.findByText(/осталось кодов: 9/)).toBeTruthy();expect(state.client.functions.invoke).toHaveBeenCalledTimes(1);expect(state.client.functions.invoke.mock.calls[0][1].body).toMatchObject({action:'recover',code:codes[0].replaceAll('-','')});expect(screen.queryByRole('region',{name:'10 резервных кодов'})).toBeNull();expect(state.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it('supports TXT download without claiming it was saved or auto-checking acknowledgement',()=>{
    const make=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    render(<BackupCodes {...issued} siteUrl={state.cfg.siteUrl} onDone={()=>{}} />);fireEvent.click(screen.getByRole('button',{name:'Скачать 10 кодов (.txt)'}));expect(make).toHaveBeenCalledOnce();expect(make.mock.calls[0][0].type).toBe('text/plain;charset=utf-8');expect(click).toHaveBeenCalledOnce();expect(screen.getByRole('checkbox').checked).toBe(false);expect(screen.getByRole('status').textContent).toContain('Проверьте');
    make.mockRestore();click.mockRestore();
  });
  it('shows only the remaining count later and requires password/acknowledgement to replace the set',async()=>{
    render(<CloudRecoverySettings account={{login:'parent_one',role:'parent'}} />);const details=screen.getByText('Резервные коды восстановления').closest('details');details.open=true;fireEvent(details,new Event('toggle'));
    expect(await screen.findByText(/Осталось неиспользованных кодов: 7 из 10/)).toBeTruthy();expect(screen.queryByText(codes[0])).toBeNull();expect(screen.getByRole('button',{name:'Перевыпустить 10 кодов'}).disabled).toBe(true);
    const user=userEvent.setup();await user.type(screen.getByLabelText('Текущий пароль для перевыпуска кодов'),'Current-fixture-123');await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Перевыпустить 10 кодов'}));
    expect(await screen.findByRole('region',{name:'10 резервных кодов'})).toBeTruthy();expect(state.runtime.replaceBackupCodes).toHaveBeenCalledWith('Current-fixture-123','captcha-fixture');
  });
});
