import { afterEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import path from 'node:path';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { CompanionAttachments } from './attachments';
import { CompanionAttachmentIssue } from '../../shared/companion/constants';
import { COMPANION_MAX_ATTACHMENT_BYTES } from '../../shared/companion/attachments';

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
    f.service.resolve(
      'pet',
      selected.map(file => file.id),
    ),
  ).rejects.toThrow('unavailable');
});
