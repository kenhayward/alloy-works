import { createReadStream, writeSync } from 'node:fs';
import { stat } from 'node:fs/promises';

/**
 * A tar archive written to a file a block at a time (EI-O). POSIX ustar, with a pax record for a size
 * ustar's eleven octal digits cannot hold, so any tar reads it and nothing is limited by its format.
 */
const BLOCK = 512;
const MOST_USTAR_SIZE = 8 ** 11 - 1;

const field = (block: Buffer, at: number, length: number, text: string) => {
  block.write(text, at, length, 'utf8');
};
const octal = (value: number, digits: number) => value.toString(8).padStart(digits, '0');

function header(name: string, size: number, type: '0' | 'x'): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error(`A tar entry's name is too long: ${name}`);
  const block = Buffer.alloc(BLOCK);
  field(block, 0, 100, name);
  field(block, 100, 8, `${octal(0o644, 7)}\0`);
  field(block, 108, 8, `${octal(0, 7)}\0`);
  field(block, 116, 8, `${octal(0, 7)}\0`);
  field(block, 124, 12, `${octal(size, 11)}\0`);
  // No modified time: one state of a tenant writes one archive, byte for byte.
  field(block, 136, 12, `${octal(0, 11)}\0`);
  field(block, 148, 8, ' '.repeat(8));
  field(block, 156, 1, type);
  field(block, 257, 6, 'ustar\0');
  field(block, 263, 2, '00');
  const sum = block.reduce((total, byte) => total + byte, 0);
  field(block, 148, 8, `${octal(sum, 6)}\0 `);
  return block;
}

/** A pax record is `<length> <key>=<value>\n`, its length counting its own digits. */
function paxRecord(key: string, value: string): string {
  const rest = ` ${key}=${value}\n`.length;
  let length = rest + String(rest).length;
  if (String(length).length !== String(rest).length) length = rest + String(length).length;
  return `${length} ${key}=${value}\n`;
}

export interface TarWriter {
  /** An entry from bytes in hand. */
  bytes(name: string, content: Buffer): void;
  /** An entry from a file on disk, read as a stream, so an object is never whole in memory. */
  file(name: string, path: string): Promise<void>;
  /** The two empty blocks that end an archive. */
  end(): void;
}

export function tarWriter(fd: number): TarWriter {
  const pad = (size: number) => {
    const over = size % BLOCK;
    if (over !== 0) writeSync(fd, Buffer.alloc(BLOCK - over));
  };
  const begin = (name: string, size: number) => {
    if (size > MOST_USTAR_SIZE) {
      const pax = Buffer.from(paxRecord('size', String(size)), 'utf8');
      writeSync(fd, header(`pax/${name}`.slice(0, 100), pax.length, 'x'));
      writeSync(fd, pax);
      pad(pax.length);
      writeSync(fd, header(name, 0, '0'));
    } else {
      writeSync(fd, header(name, size, '0'));
    }
  };
  return {
    bytes(name, content) {
      begin(name, content.length);
      writeSync(fd, content);
      pad(content.length);
    },
    async file(name, path) {
      const { size } = await stat(path);
      begin(name, size);
      for await (const chunk of createReadStream(path)) writeSync(fd, chunk as Buffer);
      pad(size);
    },
    end() {
      writeSync(fd, Buffer.alloc(BLOCK * 2));
    },
  };
}
