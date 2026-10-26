import { afterEach, expect, test, vi } from 'vitest';
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
  rm,
  symlink,
  truncate,
} from 'node:fs/promises';
import path from 'node:path';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { CompanionAttachments } from './attachments';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import {
  COMPANION_MAX_ATTACHMENT_BYTES,
  COMPANION_MAX_ATTACHMENT_NAME_LENGTH,
  companionAttachments,
} from '../../shared/companion/attachments';

const close: (() => void)[] = [];
const directories: string[] = [];
afterEach(async () => {
  close.splice(0).forEach(callback => callback());
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const { db } = createCoworkStoreHarness();
  close.push(() => db.close());
  const directory = await mkdtemp('/tmp/companion-files-');
  directories.push(directory);
  const file = path.join(directory, 'notes.md');
  await writeFile(file, 'User selected evidence.');
  return { db, directory, file, service: new CompanionAttachments(db) };
}

test('native selections persist opaque metadata and resolve only for their companion', async () => {
  const f = await fixture();
  const [attachment] = await f.service.choose('pet-one', [f.file, f.file]);
  expect(Object.keys(attachment).sort()).toEqual(['bytes', 'id', 'name']);
  expect(attachment).toMatchObject({ name: 'notes.md', bytes: 23 });
  const reopened = new CompanionAttachments(f.db);
  expect(await reopened.resolve('pet-one', [attachment.id])).toMatchObject({
    fileAttachments: [{ name: 'notes.md', extension: 'MD' }],
  });
  await expect(reopened.resolve('pet-two', [attachment.id])).rejects.toThrow('unavailable');
  await expect(reopened.images('pet-two', [attachment.id])).rejects.toThrow('unavailable');
  await expect(reopened.resolve('pet-one', ['forged'])).rejects.toThrow('unavailable');
});

test('missing, redirected, directory and oversized files fail without reading their contents', async () => {
  const f = await fixture();
  await expect(f.service.choose('pet', [f.directory])).rejects.toThrow(
    CompanionAttachmentIssue.Invalid,
  );
  const [attachment] = await f.service.choose('pet', [f.file]);
  await rm(f.file);
  await expect(f.service.resolve('pet', [attachment.id])).rejects.toThrow();
  const other = path.join(f.directory, 'other.md');
  await writeFile(other, 'Other contents');
  await symlink(other, f.file);
  await expect(f.service.resolve('pet', [attachment.id])).rejects.toThrow(
    CompanionAttachmentIssue.Unavailable,
  );
  await truncate(other, COMPANION_MAX_ATTACHMENT_BYTES + 1);
  await expect(f.service.choose('pet', [other])).rejects.toThrow(CompanionAttachmentIssue.TooLarge);
  await expect(f.service.choose('pet', Array(11).fill(other))).rejects.toThrow(
    CompanionAttachmentIssue.TooMany,
  );
});

test('image references use the existing task image and file metadata formats', async () => {
  const f = await fixture();
  const image = path.join(f.directory, 'reference.png');
  await writeFile(image, 'fixture bytes are never decoded by the reference catalog');
  const selected = await f.service.choose('pet', [image]);
  expect(
    await f.service.resolve(
      'pet',
      selected.map(file => file.id),
    ),
  ).toMatchObject({
    fileAttachments: [{ name: 'reference.png', extension: 'PNG', isImage: true }],
  });
  f.db.prepare('UPDATE companion_attachments SET expires_at = 0').run();
  await expect(
    f.service.images(
      'pet',
      selected.map(file => file.id),
    ),
  ).rejects.toThrow('unavailable');
  await expect(
    f.service.resolve(
      'pet',
      selected.map(file => file.id),
    ),
  ).rejects.toThrow('unavailable');
});

test('pasted bytes become an opaque private file with the original display name', async () => {
  const f = await fixture();
  const directory = path.join(f.directory, 'staging');
  const data = new TextEncoder().encode('Clipboard evidence with 中文.');
  const selected = await f.service.stage(
    'pet',
    { name: '../../notes.md', mimeType: 'text/markdown', data },
    directory,
  );
  expect(selected).toMatchObject({ name: 'notes.md', bytes: data.byteLength });
  expect(Object.keys(selected).sort()).toEqual(['bytes', 'id', 'name']);
  const {
    fileAttachments: [resolved],
  } = await new CompanionAttachments(f.db).resolve('pet', [selected.id]);
  expect(path.dirname(resolved.path)).toBe(await realpath(directory));
  expect(await readFile(resolved.path)).toEqual(Buffer.from(data));
  await expect(f.service.resolve('another-pet', [selected.id])).rejects.toThrow('unavailable');
  expect(await readFile(f.file, 'utf8')).toBe('User selected evidence.');
});

test('invalid transfers never write and a rejected grant removes only its staged file', async () => {
  const f = await fixture();
  const directory = path.join(f.directory, 'staging');
  const input = { name: 'pasted', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) };
  await expect(
    f.service.stage(
      'pet',
      { ...input, data: new Uint8Array(COMPANION_MAX_ATTACHMENT_BYTES + 1) },
      directory,
    ),
  ).rejects.toThrow();
  await expect(readdir(directory)).rejects.toThrow();
  vi.spyOn(f.service, 'choose').mockRejectedValueOnce(new Error('Grant was rejected'));
  await expect(f.service.stage('pet', input, directory)).rejects.toThrow('Grant was rejected');
  expect(await readdir(directory)).toEqual([]);
  const selected = await f.service.stage('pet', input, directory);
  expect(selected.name).toBe('pasted.png');
  const longName = await f.service.stage(
    'pet',
    { ...input, name: 'a'.repeat(COMPANION_MAX_ATTACHMENT_NAME_LENGTH) },
    directory,
  );
  expect(longName.name).toHaveLength(COMPANION_MAX_ATTACHMENT_NAME_LENGTH);
  expect(longName.name.endsWith('.png')).toBe(true);
  expect(companionAttachments.safeParse([longName]).success).toBe(true);
});
