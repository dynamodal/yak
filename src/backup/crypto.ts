import { SubDir, type BackupDir } from './dir';
import { base64, decodeText, encodeText, sha256Hex, unbase64 } from './format';
import { BACKUP_CHECK_LABEL } from '../core/protocol-ids';
import { DEFAULT_ITERATIONS, decryptBytes, encryptBytes, InvalidParamsError, isEncrypted, iterationsValid, MAX_ITERATIONS, MIN_ITERATIONS, WrongPassphraseError, type EncryptionParams } from '../core/crypto';

export { DEFAULT_ITERATIONS, decryptBytes, encryptBytes, InvalidParamsError, isEncrypted, iterationsValid, MAX_ITERATIONS, MIN_ITERATIONS, WrongPassphraseError, type EncryptionParams };

/**
 * Encrypted backups (docs/backups.md): one passphrase per account, a PBKDF2-SHA256 key,
 * AES-GCM per file. Every file a backup writes is encrypted; the folder then holds opaque files
 * under document ids that carry no names.
 */

export const ENCRYPTION_FILE = 'encryption.json';



export class EncryptedError extends Error {
  constructor() {
    super('These backups are encrypted. Enter the passphrase first.');
    this.name = 'EncryptedError';
  }
}

async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', encodeText(passphrase) as Uint8Array<ArrayBuffer>, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, base, 256);
  return new Uint8Array(bits);
}

const checkOf = (bits: Uint8Array): Promise<string> => sha256Hex(new Uint8Array([...bits, ...encodeText(BACKUP_CHECK_LABEL)]));
const aesKey = (bits: Uint8Array): Promise<CryptoKey> => crypto.subtle.importKey('raw', bits as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** A new passphrase: fresh salt, the parameters to keep, and the key. */
export async function newEncryption(passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<{ params: EncryptionParams; key: CryptoKey }> {
  if (!iterationsValid(iterations)) throw new InvalidParamsError();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(passphrase, salt, iterations);
  return { params: { salt: base64(salt), check: await checkOf(bits), iterations }, key: await aesKey(bits) };
}

/** The key for a passphrase and the stored parameters; a wrong passphrase is refused here. */
export async function keyFor(passphrase: string, params: EncryptionParams): Promise<CryptoKey> {
  if (!iterationsValid(params.iterations)) throw new InvalidParamsError();
  const bits = await derive(passphrase, unbase64(params.salt), params.iterations);
  if ((await checkOf(bits)) !== params.check) throw new WrongPassphraseError();
  return aesKey(bits);
}



const NAME_LABEL = 'yak/v1/blob-name';

/**
 * A file name that does not reveal the file: HMAC-SHA256 of the content hash under a key only the
 * passphrase holder has. The name key is what AES-GCM makes of 32 zero bytes with an all-zero IV
 * (used for this one message only, so no keystream is reused: real files get random IVs), run
 * through SHA-256; the same passphrase gives the same names on every device, so a folder is never
 * filled twice with one file, and the passphrase is not needed again to look a file up.
 */
export async function blobNamer(key: CryptoKey): Promise<(hash: string) => Promise<string>> {
  const raw = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12), additionalData: encodeText(NAME_LABEL) as Uint8Array<ArrayBuffer> }, key, new Uint8Array(32));
  const material = await crypto.subtle.digest('SHA-256', raw);
  const hmac = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return async (hash) => Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encodeText(hash) as Uint8Array<ArrayBuffer>)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A directory that encrypts every file written and decrypts every file read. A file without the
 * encryption header is returned as it is (older plain backups in the same folder). With no key,
 * reading an encrypted file fails with `EncryptedError`.
 */
export class EncryptedDir implements BackupDir {
  constructor(
    private readonly inner: BackupDir,
    private readonly key: CryptoKey | undefined,
  ) {}
  /** The key this view reads with, for naming files (`blobNamer`); undefined when it has none. */
  get readKey(): CryptoKey | undefined {
    return this.key;
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    if (!this.key) throw new EncryptedError();
    await this.inner.writeFile(path, await encryptBytes(this.key, data));
  }
  async readFile(path: string): Promise<Uint8Array> {
    const data = await this.inner.readFile(path);
    if (!isEncrypted(data)) return data;
    if (!this.key) throw new EncryptedError();
    return decryptBytes(this.key, data);
  }
  listDirs(path: string): Promise<string[]> {
    return this.inner.listDirs(path);
  }
  listFiles(path: string): Promise<string[]> {
    return this.inner.listFiles(path);
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
  async removeFile(path: string): Promise<void> {
    await this.inner.removeFile?.(path);
  }
  async removeDir(path: string): Promise<void> {
    await this.inner.removeDir?.(path);
  }
}

/** The encryption parameters written next to an account's backups, if it has encrypted ones. */
export async function readFolderEncryption(root: BackupDir, account: string): Promise<EncryptionParams | undefined> {
  return readParamsAt(new SubDir(root, account));
}

/** The parameters in an account folder itself. */
export async function readParamsAt(dir: BackupDir): Promise<EncryptionParams | undefined> {
  try {
    const raw = JSON.parse(decodeText(await dir.readFile(ENCRYPTION_FILE))) as Partial<EncryptionParams>;
    return typeof raw.salt === 'string' && typeof raw.check === 'string' && typeof raw.iterations === 'number' ? (raw as EncryptionParams) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeFolderEncryption(root: BackupDir, account: string, params: EncryptionParams): Promise<void> {
  const dir = new SubDir(root, account);
  const text = `${JSON.stringify(params, null, 2)}\n`;
  const have = await readFolderEncryption(root, account);
  if (have && have.salt === params.salt && have.check === params.check) return;
  await dir.writeFile(ENCRYPTION_FILE, encodeText(text));
}

/** The folder with the account's files readable: decrypting when the account's backups are encrypted and `key` is given. */
export function withKey(root: BackupDir, key: CryptoKey | undefined): BackupDir {
  return new EncryptedDir(root, key);
}
