import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { athleteFileName, backupFileName, type AthleteFile, type Backup } from '@/domain/backup';

/** Hands a JSON file to the share sheet (save to Files / iCloud Drive, AirDrop, mail); a download on the web. */
async function shareJson(name: string, data: unknown, title: string): Promise<void> {
  const json = JSON.stringify(data);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: title });
}

export function shareBackupFile(backup: Backup): Promise<void> {
  return shareJson(backupFileName(new Date()), backup, '保存备份文件');
}

/** One athlete's data, to send to them or to another phone. */
export function shareAthleteFile(file: AthleteFile): Promise<void> {
  const name = file.tables.athlete[0]?.name;
  return shareJson(athleteFileName(typeof name === 'string' ? name : '', new Date()), file, '发送运动员数据');
}

/** The text of a file the person picks, or null if they cancel. */
export async function pickBackupText(): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'public.json', 'text/plain'], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  return asset.file ? asset.file.text() : new File(asset.uri).text();
}
