import Storage from 'expo-sqlite/kv-store';

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
export const CONSENT_TEXT = [
  'Jump Attack 会读取你用快捷指令从「健康」App 复制出来的 HRV、静息心率、睡眠和呼吸频率，用来判断今天的恢复状态和训练量。',
  '· 数据只保存在这台手机上，不会上传到任何服务器。',
  '· 只在你点「从苹果健康导入」时读一次剪贴板，iOS 会再问你是否允许粘贴。',
  '· 导入只是填进表单，你确认后点保存才会记录。',
  '· 可以随时在「设置方法」页撤回同意。',
].join('\n');
