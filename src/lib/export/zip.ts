/**
 * A small streaming ZIP writer for exports (PKWARE APPNOTE 6.3.10). Entries are deflated and
 * followed by a data descriptor, so each one is written as it is produced, without holding a whole
 * table in memory or knowing its size first. The output is a pull-based stream: nothing more is
 * read from the database than the client has taken.
 *
 * Deflate: content is compressed on the thread pool in blocks of about 64 KB, each ended with a
 * sync flush, and the last one finished; together they form one valid deflate stream. No ZIP64, so each entry and
 * the archive must stay under 4 GB and 65,535 entries; the writer refuses rather than corrupts.
 */
import { promisify } from "node:util";
import { constants, crc32, deflateRaw } from "node:zlib";

const deflate = promisify(deflateRaw);
const LIMIT = 0xffffffff;
const BLOCK = 64 * 1024;
const FLAGS = 0x0808; // bit 3: sizes in a data descriptor; bit 11: UTF-8 names
const DEFLATE = 8;
const VERSION = 20;

export type ZipChunk = string | Uint8Array;

export interface ZipEntry {
  name: string;
  content: AsyncIterable<ZipChunk> | Iterable<ZipChunk>;
}

interface Written {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(at.getUTCFullYear(), 1980);
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

function localHeader(name: Buffer, stamp: { time: number; date: number }): Buffer {
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(VERSION, 4);
  b.writeUInt16LE(FLAGS, 6);
  b.writeUInt16LE(DEFLATE, 8);
  b.writeUInt16LE(stamp.time, 10);
  b.writeUInt16LE(stamp.date, 12);
  // CRC and sizes are zero here and follow the data in the descriptor.
  b.writeUInt16LE(name.length, 26);
  b.writeUInt16LE(0, 28);
  return Buffer.concat([b, name]);
}

function descriptor(w: Written): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(0x08074b50, 0);
  b.writeUInt32LE(w.crc, 4);
  b.writeUInt32LE(w.compressed, 8);
  b.writeUInt32LE(w.size, 12);
  return b;
}

function centralRecord(w: Written, stamp: { time: number; date: number }): Buffer {
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(VERSION, 4);
  b.writeUInt16LE(VERSION, 6);
  b.writeUInt16LE(FLAGS, 8);
  b.writeUInt16LE(DEFLATE, 10);
  b.writeUInt16LE(stamp.time, 12);
  b.writeUInt16LE(stamp.date, 14);
  b.writeUInt32LE(w.crc, 16);
  b.writeUInt32LE(w.compressed, 20);
  b.writeUInt32LE(w.size, 24);
  b.writeUInt16LE(w.name.length, 28);
  b.writeUInt32LE(w.offset, 42);
  return Buffer.concat([b, w.name]);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(count, 8);
  b.writeUInt16LE(count, 10);
  b.writeUInt32LE(size, 12);
  b.writeUInt32LE(offset, 16);
  return b;
}

function tooLarge(): never {
  throw new Error("The export is larger than a ZIP file without ZIP64 can hold.");
}

/** The archive as a sequence of byte chunks; entries are read one after another, in order. */
export async function* zip(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>, at: Date = new Date()): AsyncGenerator<Uint8Array> {
  const stamp = dosDateTime(at);
  const written: Written[] = [];
  let offset = 0;

  for await (const entry of entries) {
    const w: Written = { name: Buffer.from(entry.name, "utf8"), crc: 0, compressed: 0, size: 0, offset };
    const header = localHeader(w.name, stamp);
    offset += header.length;
    yield header;

    // Small pieces are gathered up to BLOCK first: each deflate call adds a few bytes of framing.
    let pending: Buffer[] = [];
    let pendingSize = 0;
    const compress = async (final: boolean): Promise<Buffer> => {
      const data = Buffer.concat(pending, pendingSize);
      pending = [];
      pendingSize = 0;
      const out = await deflate(data, final ? {} : { finishFlush: constants.Z_SYNC_FLUSH });
      w.compressed += out.length;
      offset += out.length;
      return out;
    };
    for await (const chunk of entry.content) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
      if (bytes.length === 0) continue;
      w.crc = crc32(bytes, w.crc);
      w.size += bytes.length;
      pending.push(bytes);
      pendingSize += bytes.length;
      if (pendingSize >= BLOCK) yield await compress(false);
    }
    yield await compress(true);

    if (w.size > LIMIT || w.compressed > LIMIT || offset > LIMIT) tooLarge();
    const tail = descriptor(w);
    offset += tail.length;
    yield tail;
    written.push(w);
    if (written.length > 0xffff) tooLarge();
  }

  const start = offset;
  let size = 0;
  for (const w of written) {
    const record = centralRecord(w, stamp);
    size += record.length;
    yield record;
  }
  if (start + size > LIMIT) tooLarge();
  yield endOfCentralDirectory(written.length, size, start);
}

/** A Response body for a ZIP produced by the generator above. */
export function zipResponse(chunks: AsyncGenerator<Uint8Array>, filename: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
