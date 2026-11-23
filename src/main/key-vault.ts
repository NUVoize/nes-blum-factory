import { existsSync, readFileSync, rmSync } from 'node:fs';
import { atomicWriteFile } from '../core/util/atomic.js';
import { maskKey } from '../core/llm/redact.js';

// KeyVault (PLAN ADR-4). The cipher is Electron safeStorage (Windows DPAPI) in the app and an injected
// fake in tests. The key stays in main: the renderer only ever sees `hasKey` and a masked suffix.
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface KeyStatus {
  hasKey: boolean;
  masked: string | null;
  /** Set when a stored key cannot be used on this computer. */
  problem: { fr: string; en: string } | null;
  encryptionAvailable: boolean;
}

export class KeyVaultError extends Error {
  constructor(
    readonly fr: string,
    readonly en: string,
  ) {
    super(en);
  }
}

const KEY_FORMAT = /^sk-ant-[A-Za-z0-9_\-]{20,}$/;

export const MSG_REENTER = {
  fr: 'Clé à saisir de nouveau sur cet ordinateur',
  en: 'Enter the key again on this computer',
};

export class KeyVault {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  save(key: string): KeyStatus {
    const k = key.trim();
    if (!KEY_FORMAT.test(k)) {
      throw new KeyVaultError('Cette clé ne ressemble pas à une clé API Anthropic (sk-ant-…).', 'This does not look like an Anthropic API key (sk-ant-…).');
    }
    if (!this.cipher.isEncryptionAvailable()) {
      // Never a plaintext fallback.
      throw new KeyVaultError(
        'Windows ne peut pas chiffrer la clé sur ce compte : elle n’est pas enregistrée.',
        'Windows cannot encrypt the key on this account: it was not saved.',
      );
    }
    atomicWriteFile(this.file, this.cipher.encryptString(k));
    return this.status();
  }

  clear(): KeyStatus {
    rmSync(this.file, { force: true });
    return this.status();
  }

  private decrypt(): { key: string | null; problem: KeyStatus['problem'] } {
    if (!existsSync(this.file)) return { key: null, problem: null };
    if (!this.cipher.isEncryptionAvailable()) return { key: null, problem: MSG_REENTER };
    try {
      const key = this.cipher.decryptString(readFileSync(this.file));
      if (!KEY_FORMAT.test(key)) return { key: null, problem: MSG_REENTER };
      return { key, problem: null };
    } catch {
      // DPAPI is per user and per machine: a key from another PC or user lands here.
      return { key: null, problem: MSG_REENTER };
    }
  }

  status(): KeyStatus {
    const { key, problem } = this.decrypt();
    return {
      hasKey: key !== null,
      masked: key ? maskKey(key) : null,
      problem,
      encryptionAvailable: this.cipher.isEncryptionAvailable(),
    };
  }

  /** Main process only. Never exposed over IPC. */
  readKeyForMain(): string | null {
    return this.decrypt().key;
  }
}
