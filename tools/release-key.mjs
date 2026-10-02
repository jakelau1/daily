// The release key for the Android app: make it once, check a backup copy of it.
//   node tools/release-key.mjs create             make the key (asks you to choose a password; run in a real terminal)
//   node tools/release-key.mjs check <file.jks>   open a copy of the key and compare its public fingerprint with the original's
//   node tools/release-key.mjs check-backup <file.jks.gpg>   decrypt an encrypted copy into a scratch folder, check it, delete the scratch copy
// The password is only ever typed into the prompts of keytool (Java's own key tool) and gpg, in your terminal. This script never
// sees it, never writes it anywhere, and refuses to run unless it has a real terminal. The key file is kept outside the project
// folder (default ~/keys/get-ready/); the project's .gitignore also blocks *.jks and *.keystore as a second guard.
// Only the PUBLIC fingerprint is saved (next to the key), so a copy can be checked later.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = path.join(os.homedir(), 'keys', 'get-ready');
const KEY = path.join(DIR, 'get-ready-release.jks');
const FINGERPRINT = path.join(DIR, 'get-ready-release.fingerprint');
const stop = m => { console.error('\nStopped: ' + m + '\n'); process.exit(1); };
if (!process.stdin.isTTY) stop('run this in a real terminal: the password is typed into a prompt, never passed through an assistant or a script.');
const keytool = (args, capture) => spawnSync('keytool', args, capture ? { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] } : { stdio: 'inherit' });
const fingerprintOf = file => {
  const r = keytool(['-list', '-keystore', file, '-alias', 'get-ready'], true);       // keytool asks for the password itself
  if (r.status !== 0) return null;
  const m = /SHA-256\):\s*([0-9A-F:]+)/i.exec(r.stdout); return m ? m[1].toUpperCase() : null;
};
const cmd = process.argv[2];

if (cmd === 'create') {
  if (fs.existsSync(KEY)) stop(`a key already exists at ${KEY}. This script never overwrites one.`);
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  console.log(`Making the release key at ${KEY}\nChoose a long password and save it in your password manager BEFORE you finish typing it twice.\n`);
  const r = keytool(['-genkeypair', '-alias', 'get-ready', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
    '-dname', 'CN=Get Ready', '-storetype', 'PKCS12', '-keystore', KEY]);
  if (r.status !== 0 || !fs.existsSync(KEY)) stop('the key was not made.');
  fs.chmodSync(KEY, 0o600);
  console.log('\nEnter the password once more so the public fingerprint can be recorded:');
  const fp = fingerprintOf(KEY);
  if (!fp) stop('could not read the fingerprint back; the key file exists but check the password.');
  fs.writeFileSync(FINGERPRINT, fp + '\n');
  console.log(`\nKey made. Public fingerprint (safe to share): ${fp}\nSaved to ${FINGERPRINT}\n
NEXT: back it up in two places, encrypted:
  gpg --symmetric --cipher-algo AES256 -o ~/Desktop/get-ready-release.jks.gpg ${KEY}
  (use a different passphrase from the key's own, and put that in your password manager too)
Copy that .gpg file to two places that are not this computer's disk, then prove a copy works:
  node tools/release-key.mjs check-backup "/run/media/$USER/<your drive>/get-ready-release.jks.gpg"`);
} else if (cmd === 'check' || cmd === 'check-backup') {
  const given = process.argv[3]; if (!given || !fs.existsSync(given)) stop('give the path of the file to check.');
  if (!fs.existsSync(FINGERPRINT)) stop(`no recorded fingerprint at ${FINGERPRINT}; was the key made with this script?`);
  const expected = fs.readFileSync(FINGERPRINT, 'utf8').trim();
  let file = given, scratch = null;
  if (cmd === 'check-backup') {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keycheck-')); file = path.join(scratch, 'restored.jks');
    console.log('Decrypting the copy into a scratch folder (gpg asks for the copy\'s passphrase):');
    const g = spawnSync('gpg', ['--decrypt', '--output', file, given], { stdio: 'inherit' });
    if (g.status !== 0) { fs.rmSync(scratch, { recursive: true, force: true }); stop('gpg could not decrypt the copy.'); }
    console.log('\nNow the key\'s own password (to open the restored file):');
  }
  const fp = fingerprintOf(file);
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  if (!fp) stop('could not open the key (wrong password, or not a key file).');
  if (fp === expected) console.log(`\nGOOD: the copy opens and its fingerprint matches the original.\n${fp}`);
  else { console.log(`\nBAD: the fingerprint differs.\n  copy:     ${fp}\n  expected: ${expected}`); process.exit(1); }
} else stop('use: create | check <file.jks> | check-backup <file.jks.gpg>');
