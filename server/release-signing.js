// Release signatures: the maintainer signs SHA256SUMS.txt with an Ed25519 key kept outside the repository
// (tools/release-sign.mjs). The console trusts a mirror only for transport: the signature anchors the checksums.
import crypto from 'node:crypto';

export const SUMS_ASSET = 'SHA256SUMS.txt';
export const SIGNATURE_ASSET = 'SHA256SUMS.txt.sig';

/** SPKI DER (base64) of every accepted signing key. Keep the previous key here for one release when rotating. */
export const RELEASE_PUBLIC_KEYS = [
  'MCowBQYDK2VwAyEA46g58eTNlxwo1xbSghcO8reDiVV+EHUWfZ+6eN+jvjk=',
];

/** The signed bytes bind the checksums to one tag, so a mirror cannot relabel another release's files. */
export const signedMessage = (tag, sums) => Buffer.concat([Buffer.from(`stronghold-protocol-release\n${tag}\n`), Buffer.from(sums)]);

/** Parse the .sig asset: one base64 line holding a 64-byte Ed25519 signature. */
export function parseSignature(text) {
  const line = String(text).trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(line)) throw new Error('发布签名格式错误');
  return Buffer.from(line, 'base64');
}

export function signSums(tag, sums, privateKey) {
  return crypto.sign(null, signedMessage(tag, sums), privateKey).toString('base64');
}

export function verifySums(tag, sums, signature, keys = RELEASE_PUBLIC_KEYS) {
  const message = signedMessage(tag, sums);
  return keys.some((der) => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, message, key, signature);
    } catch { return false; }
  });
}

/** The checksum of one asset from SHA256SUMS.txt (`<sha256>  <name>`, optional `*` binary marker). */
export function sumFor(sums, name) {
  const line = String(sums).split(/\r?\n/).find((s) => s.trim().replace(/^[a-f0-9]{64}\s+\*?/i, '') === name);
  if (!line || !/^[a-f0-9]{64}\s/i.test(line)) throw new Error('SHA256SUMS.txt 缺少安装包校验值');
  return line.slice(0, 64).toLowerCase();
}
