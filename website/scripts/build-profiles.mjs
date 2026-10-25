import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
export function buildProfiles() {
  if (!process.env.DATASET_DIR) return;
  const output =
    process.env.PROFILES_FILE ||
    join(process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime'), 'profiles.json');
  const executable =
    process.env.PYTHON_EXE || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(
    executable,
    [
      fileURLToPath(new URL('../analytics/build_profiles.py', import.meta.url)),
      '--companies',
      join(process.env.DATASET_DIR, 'df_Uid_data_hack.csv'),
      '--payments',
      join(process.env.DATASET_DIR, 'df_Uid_payment_hack.csv'),
      '--links',
      join(process.env.DATASET_DIR, 'df_Fid_Uid_link_hack.csv'),
      '--output',
      output,
    ],
    { stdio: 'inherit', windowsHide: true }
  );
  if (result.error || result.status !== 0)
    throw new Error('Profile build failed. Python 3.10+ and the three CSV files are required.');
  process.env.PROFILES_FILE = output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) buildProfiles();
