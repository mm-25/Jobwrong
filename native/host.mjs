import { once } from 'node:events';
import { endianness } from 'node:os';
import { fail, handleRequest } from './vault.mjs';

const inputLimit = 32 * 1024;
const outputLimit = 64 * 1024;
const littleEndian = endianness() === 'LE';
const decoder = new TextDecoder('utf-8', { fatal: true });

async function reply(message) {
  let data = Buffer.from(JSON.stringify(message));
  if (data.length > outputLimit) data = Buffer.from(JSON.stringify(fail('response_too_large')));
  const header = Buffer.alloc(4);
  if (littleEndian) header.writeUInt32LE(data.length);
  else header.writeUInt32BE(data.length);
  if (!process.stdout.write(Buffer.concat([header, data]))) await once(process.stdout, 'drain');
}

async function dispatch(data) {
  let request;
  try {
    request = JSON.parse(decoder.decode(data));
  } catch {
    await reply(fail('invalid_json'));
    return;
  }
  await reply(await handleRequest(request));
}

async function run() {
  const header = Buffer.alloc(4);
  let headerBytes = 0;
  let data;
  let dataBytes = 0;
  for await (const input of process.stdin) {
    let offset = 0;
    while (offset < input.length) {
      if (!data) {
        const headerEnd = Math.min(input.length, offset + 4 - headerBytes);
        headerBytes += input.copy(header, headerBytes, offset, headerEnd);
        offset = headerEnd;
        if (headerBytes < 4) continue;
        const size = littleEndian ? header.readUInt32LE() : header.readUInt32BE();
        if (!size || size > inputLimit) {
          await reply(fail('invalid_frame'));
          return;
        }
        data = Buffer.alloc(size);
      }
      const dataEnd = Math.min(input.length, offset + data.length - dataBytes);
      dataBytes += input.copy(data, dataBytes, offset, dataEnd);
      offset = dataEnd;
      if (dataBytes === data.length) {
        await dispatch(data);
        headerBytes = 0;
        dataBytes = 0;
        data = undefined;
      }
    }
  }
  if (headerBytes) await reply(fail('invalid_frame'));
}

process.stdout.on('error', () => process.exit(0));
run().catch(() => process.exit(1));
