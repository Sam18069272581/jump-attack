import Storage from 'expo-sqlite/kv-store';

import { tr } from '@/i18n';

const KEY = 'health-import-consent';

/** Whether the user agreed to pasting Apple Health data in, kept on the device across launches. */
export async function hasHealthConsent(): Promise<boolean> {
  return (await Storage.getItem(KEY)) === 'yes';
}

export async function setHealthConsent(agreed: boolean): Promise<void> {
  if (agreed) await Storage.setItem(KEY, 'yes');
  else await Storage.removeItem(KEY);
}

export const CONSENT_TITLE = '读取健康数据';
const CONSENT_LINES = [
  'Jump Attack 会读取你用快捷指令从「健康」App 复制出来的 HRV、静息心率、睡眠和呼吸频率，用来判断今天的恢复状态和训练量。',
  '· 数据保存在这台手机上。只有你在「我的 → 数据备份与同步」登录了自己的云端账号，才会随全部数据一起备份过去，不会给其他任何人。',
  '· 只在你点「从苹果健康导入」时读一次剪贴板，iOS 会再问你是否允许粘贴。',
  '· 导入只是填进表单，你确认后点保存才会记录。',
  '· 可以随时在「设置方法」页撤回同意。',
];

export function consentText(): string {
  return CONSENT_LINES.map((line) => tr(line)).join('\n');
}
