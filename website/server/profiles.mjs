import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export async function loadProfiles(path = process.env.PROFILES_FILE) {
  const filename =
    path ||
    join(process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime'), 'profiles.json');
  let value;
  try {
    value = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (!path && error.code === 'ENOENT') return null;
    throw error;
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 100000)
    throw new Error('Unsupported profiles file');
  const byId = new Map();
  for (const profile of value.profiles) {
    if (
      !/^U_\d+$/.test(profile.syntheticU) ||
      byId.has(profile.syntheticU) ||
      !profile.bankProducts ||
      !profile.counterparties ||
      !profile.affiliation ||
      !profile.industryPosition
    )
      throw new Error('Invalid company profile');
    byId.set(profile.syntheticU, profile);
  }
  return { rows: [...byId.values()], byId, builtAt: value.builtAt, stats: value.stats };
}
