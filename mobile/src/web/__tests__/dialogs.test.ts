import type { AlertButton } from 'react-native';

import { installWebDialogs, showAlert, type BrowserDialogs } from '@/web/dialogs';

// react-native-web's Alert.alert does nothing, so on the web every confirmation would be silently skipped.
function browser(answers: { confirm?: boolean; prompt?: string | null } = {}): BrowserDialogs & { shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    alert: (m) => void shown.push(`alert:${m}`),
    confirm: (m) => (shown.push(`confirm:${m}`), answers.confirm ?? true),
    prompt: (m) => (shown.push(`prompt:${m}`), answers.prompt ?? null),
  };
}

it('shows a message-only alert and runs its single button', () => {
  const b = browser();
  const ok = jest.fn();
  showAlert('保存失败', 'disk full', [{ text: '好', onPress: ok }], b);
  expect(b.shown).toEqual(['alert:保存失败\n\ndisk full']);
  expect(ok).toHaveBeenCalled();

  showAlert('已复制示例', undefined, undefined, b);
  expect(b.shown[1]).toBe('alert:已复制示例');
});

it('turns cancel + action into a confirm and runs the chosen button', () => {
  const remove = jest.fn();
  const cancel = jest.fn();
  const buttons: AlertButton[] = [
    { text: '取消', style: 'cancel', onPress: cancel },
    { text: '删除', style: 'destructive', onPress: remove },
  ];

  const yes = browser({ confirm: true });
  showAlert('删除第 2 组？', '', buttons, yes);
  expect(yes.shown).toEqual(['confirm:删除第 2 组？\n\n（确定 = 删除）']);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();

  showAlert('删除第 2 组？', '', buttons, browser({ confirm: false }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('treats the first button as cancel when none is marked', () => {
  const agree = jest.fn();
  const refuse = jest.fn();
  showAlert('隐私说明', '数据只存在本机', [{ text: '不同意', onPress: refuse }, { text: '同意并导入', onPress: agree }], browser({ confirm: true }));
  expect(agree).toHaveBeenCalled();
  expect(refuse).not.toHaveBeenCalled();
});

it('patches Alert.alert and Alert.prompt on the web', () => {
  const b = browser({ prompt: '小王' });
  const target: { alert: (...a: unknown[]) => void; prompt?: (...a: unknown[]) => void } = { alert: () => {} };
  installWebDialogs(target, b);

  const done = jest.fn();
  target.alert('结束训练？', '还有 2 组没打勾', [{ text: '继续练', style: 'cancel' }, { text: '结束', onPress: done }]);
  expect(done).toHaveBeenCalled();

  const named = jest.fn();
  target.prompt?.('添加测试对象', '输入名字', named);
  expect(b.shown.at(-1)).toBe('prompt:添加测试对象\n\n输入名字');
  expect(named).toHaveBeenCalledWith('小王');
});
