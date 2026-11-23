import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskKey, redact, redactForLog } from '../src/core/llm/redact';
import { KeyVault, KeyVaultError, MSG_REENTER, type Cipher } from '../src/main/key-vault';
import { tempDir } from './helpers';

const KEY = 'sk-ant-api03-SECRETsecretSECRET-abcdefghijklmnop-WXYZ';

/** Stand-in for DPAPI: a per-"machine" XOR mask. Another machine id cannot decrypt. */
function fakeCipher(machine: number, available = true): Cipher {
  const mask = (b: Buffer) => Buffer.from(b.map((x, i) => x ^ ((machine + i * 31) & 0xff)));
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.concat([Buffer.from([0xd0, machine]), mask(Buffer.from(s, 'utf8'))]),
    decryptString: (b) => {
      if (b[0] !== 0xd0 || b[1] !== machine) throw new Error('DPAPI: The data is invalid.');
      return mask(b.subarray(2)).toString('utf8');
    },
  };
}

describe('M1 KeyVault and redaction', () => {
  it('M1-T8 the stored file never contains the plaintext key; status gives hasKey + masked suffix only', () => {
    const file = path.join(tempDir(), 'key.bin');
    const vault = new KeyVault(file, fakeCipher(7));
    expect(vault.status()).toEqual({ hasKey: false, masked: null, problem: null, encryptionAvailable: true });
    const st = vault.save(`  ${KEY}  `);
    const bytes = readFileSync(file);
    expect(bytes.includes(Buffer.from(KEY))).toBe(false);
    expect(bytes.toString('latin1')).not.toContain('sk-ant');
    expect(st).toEqual({ hasKey: true, masked: 'sk-ant-…WXYZ', problem: null, encryptionAvailable: true });
    expect(JSON.stringify(st)).not.toContain(KEY);
    expect(vault.readKeyForMain()).toBe(KEY);
    expect(vault.clear().hasKey).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('M1-T8 the renderer API exposes no key getter (preload source scan)', () => {
    const preload = readFileSync(new URL('../src/preload/preload.ts', import.meta.url), 'utf8');
    const keyBlock = /key:\s*\{([^}]*)\}/.exec(preload)![1]!;
    const names = [...keyBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(names).toEqual(['clear', 'save', 'status', 'test']);
    expect(preload).not.toMatch(/readKeyForMain|getKey|apiKey/);
    const api = readFileSync(new URL('../src/shared/api.ts', import.meta.url), 'utf8');
    expect(api).not.toMatch(/readKeyForMain|getKey\(/);
  });

  it('M1-T8 a key from another computer or user gives « Clé à saisir de nouveau sur cet ordinateur »', () => {
    const file = path.join(tempDir(), 'key.bin');
    new KeyVault(file, fakeCipher(1)).save(KEY);
    const elsewhere = new KeyVault(file, fakeCipher(2));
    const st = elsewhere.status();
    expect(st.hasKey).toBe(false);
    expect(st.problem).toEqual(MSG_REENTER);
    expect(MSG_REENTER.fr).toBe('Clé à saisir de nouveau sur cet ordinateur');
    expect(elsewhere.readKeyForMain()).toBeNull();
  });

  it('M1-T8 no encryption available: refuses to save, says why, never writes plaintext', () => {
    const file = path.join(tempDir(), 'key.bin');
    const vault = new KeyVault(file, fakeCipher(3, false));
    let err: unknown;
    try {
      vault.save(KEY);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KeyVaultError);
    expect((err as KeyVaultError).fr).toMatch(/ne peut pas chiffrer/);
    expect(existsSync(file)).toBe(false);
    expect(vault.status().encryptionAvailable).toBe(false);
    expect(() => vault.save('pas-une-cle')).toThrow(KeyVaultError);
  });

  it('M1-T8 log redaction masks sk-ant- strings in messages, SDK error objects and request headers', () => {
    expect(maskKey(KEY)).toBe('sk-ant-…WXYZ');
    const err = Object.assign(new Error(`401 invalid x-api-key: ${KEY}`), {
      status: 401,
      headers: { 'x-api-key': KEY, 'request-id': 'req_1' },
      request: { headers: new Headers({ 'X-Api-Key': KEY, Authorization: `Bearer ${KEY}` }) },
      error: { type: 'error', error: { message: `key ${KEY} is invalid` } },
      cause: new Error(`inner ${KEY}`),
    });
    const out = redactForLog(err);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('SECRETsecret');
    expect(out).toContain('sk-ant-…WXYZ');
    expect(out).toContain('req_1');
    expect(redactForLog(`plain ${KEY} text`)).toBe('plain sk-ant-…WXYZ text');
    const obj = redact({ apiKey: KEY, nested: [{ note: KEY }] }) as { apiKey: string; nested: Array<{ note: string }> };
    expect(obj.apiKey).toBe('[masqué]');
    expect(obj.nested[0]!.note).toBe('sk-ant-…WXYZ');
  });
});
