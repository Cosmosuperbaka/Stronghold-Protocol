// Small ZIP32 adapter using browser primitives. Writes stored entries; reads stored/DEFLATE entries.
// Archive policy (names, counts, hashes, total sizes) belongs to archive.js; this layer validates ZIP structure/CRC.
const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export class Crc32 {
  constructor() { this.value = 0xffffffff; }
  append(bytes) { for (const n of bytes) this.value = table[(this.value ^ n) & 255] ^ (this.value >>> 8); }
  get() { return (this.value ^ 0xffffffff) >>> 0; }
}
export class BlobReader {
  constructor(blob) { this.blob = blob; this.size = blob.size; }
  async init() {}
  async readUint8Array(offset, length) { return new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer()); }
}
export class BlobWriter {
  constructor(type = 'application/zip') { this.type = type; }
}
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const abort = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError'); };
const invalid = () => { throw new Error('Invalid or unsupported ZIP structure'); };

export class ZipWriter {
  constructor(writer) { this.type = writer.type; this.parts = []; this.entries = []; this.offset = 0; this.closed = false; }
  async add(filename, reader, { signal } = {}) {
    abort(signal);
    if (this.closed || this.entries.length >= 50001) invalid();
    const name = encoder.encode(filename), bytes = await reader.readUint8Array(0, reader.size);
    abort(signal);
    if (name.length > 65535 || this.offset + bytes.length + name.length + 30 >= 0x80000000) invalid();
    const crc = new Crc32(); crc.append(bytes);
    const header = new Uint8Array(30 + name.length), d = view(header);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x800, true);
    d.setUint32(14, crc.get(), true); d.setUint32(18, bytes.length, true); d.setUint32(22, bytes.length, true);
    d.setUint16(26, name.length, true); header.set(name, 30);
    this.entries.push({ name, crc: crc.get(), size: bytes.length, offset: this.offset });
    this.parts.push(header, bytes); this.offset += header.length + bytes.length;
  }
  async close() {
    if (this.closed) invalid(); this.closed = true;
    const start = this.offset;
    for (const e of this.entries) {
      const central = new Uint8Array(46 + e.name.length), d = view(central);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
      d.setUint32(16, e.crc, true); d.setUint32(20, e.size, true); d.setUint32(24, e.size, true);
      d.setUint16(28, e.name.length, true); d.setUint32(42, e.offset, true); central.set(e.name, 46);
      this.parts.push(central); this.offset += central.length;
    }
    const end = new Uint8Array(22), d = view(end);
    d.setUint32(0, 0x06054b50, true); d.setUint16(8, this.entries.length, true); d.setUint16(10, this.entries.length, true);
    d.setUint32(12, this.offset - start, true); d.setUint32(16, start, true);
    const blob = new Blob([...this.parts, end], { type: this.type }); this.parts = []; return blob;
  }
}

export class ZipReader {
  constructor(source) { this.source = source; this.ranges = []; this.central = 0; }
  async *getEntriesGenerator() {
    const size = this.source.size, tailLength = Math.min(size, 65557);
    if (size < 22 || size > 0x80000000) invalid();
    const tail = await this.source.readUint8Array(size - tailLength, tailLength), d = view(tail);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (d.getUint32(i, true) === 0x06054b50 && i + 22 + d.getUint16(i + 20, true) === tail.length) { end = i; break; }
    if (end < 0 || d.getUint16(end + 4, true) || d.getUint16(end + 6, true)) invalid();
    const count = d.getUint16(end + 10, true), length = d.getUint32(end + 12, true), offset = d.getUint32(end + 16, true);
    if (count > 50001 || count !== d.getUint16(end + 8, true) || offset + length !== size - tailLength + end || length > 32 * 1024 * 1024) invalid();
    this.central = offset;
    const bytes = await this.source.readUint8Array(offset, length), cd = view(bytes); let pos = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > length || cd.getUint32(pos, true) !== 0x02014b50) invalid();
      const flags = cd.getUint16(pos + 8, true), method = cd.getUint16(pos + 10, true);
      const nl = cd.getUint16(pos + 28, true), extra = cd.getUint16(pos + 30, true), comment = cd.getUint16(pos + 32, true);
      if (pos + 46 + nl + extra + comment > length || cd.getUint16(pos + 34, true) || ![0, 8].includes(method) || (flags & ~0x808)) invalid();
      const filename = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nl));
      const e = { filename, encrypted: !!(flags & 1), directory: filename.endsWith('/'), compressionMethod: method,
        crc32: cd.getUint32(pos + 16, true), compressedSize: cd.getUint32(pos + 20, true), uncompressedSize: cd.getUint32(pos + 24, true),
        localOffset: cd.getUint32(pos + 42, true), flags, localDirectory: null };
      e.getData = async (writer, opts = {}) => this.extract(e, writer, opts);
      pos += 46 + nl + extra + comment; yield e;
    }
    if (pos !== length) invalid();
  }
  async extract(e, writer, { signal, checkOverlappingEntryOnly = false } = {}) {
    abort(signal);
    if (!e.localDirectory) {
      const h = await this.source.readUint8Array(e.localOffset, 30);
      if (h.length !== 30) invalid(); const d = view(h);
      if (d.getUint32(0, true) !== 0x04034b50 || d.getUint16(6, true) !== e.flags || d.getUint16(8, true) !== e.compressionMethod) invalid();
      const nl = d.getUint16(26, true), extra = d.getUint16(28, true), dataOffset = e.localOffset + 30 + nl + extra;
      const name = await this.source.readUint8Array(e.localOffset + 30, nl);
      if (decoder.decode(name) !== e.filename || dataOffset + e.compressedSize > this.central) invalid();
      let end = dataOffset + e.compressedSize;
      if (e.flags & 8) {
        const descriptor = await this.source.readUint8Array(end, Math.min(16, this.central - end));
        if (descriptor.length < 12) invalid(); const dv = view(descriptor), off = dv.getUint32(0, true) === 0x08074b50 ? 4 : 0;
        if (descriptor.length < off + 12 || dv.getUint32(off, true) !== e.crc32 || dv.getUint32(off + 4, true) !== e.compressedSize || dv.getUint32(off + 8, true) !== e.uncompressedSize) invalid();
        end += off + 12;
      } else if (d.getUint32(14, true) !== e.crc32 || d.getUint32(18, true) !== e.compressedSize || d.getUint32(22, true) !== e.uncompressedSize) invalid();
      if (end > this.central || this.ranges.some(([a,b]) => e.localOffset < b && end > a)) invalid();
      this.ranges.push([e.localOffset, end]); e.localDirectory = { dataOffset };
    }
    if (checkOverlappingEntryOnly) return;
    let stream = new Blob([await this.source.readUint8Array(e.localDirectory.dataOffset, e.compressedSize)]).stream();
    if (e.compressionMethod === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const sink = writer?.getWriter(), reader = stream.getReader(), crc = new Crc32(); let size = 0;
    try {
      for (;;) {
        abort(signal); const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > e.uncompressedSize) invalid(); crc.append(value);
        if (sink) await sink.write(value);
      }
      if (size !== e.uncompressedSize || crc.get() !== e.crc32) invalid();
      await sink?.close();
    } catch (error) { await reader.cancel(error).catch(() => {}); await sink?.abort(error).catch(() => {}); throw error; }
    finally { reader.releaseLock(); sink?.releaseLock(); }
  }
  async close() {}
}
