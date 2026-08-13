import type { IMSettings } from './types';

/** Describe the structured channel media reply contract available to Pi. */
export function buildIMMediaInstruction(_imSettings: IMSettings): string {
  return `<im_media_capabilities>
You can send an existing local file with a channel reply by referencing its absolute path.

Use Markdown for the clearest result:
- Image: ![description](/absolute/path/to/image.png)
- Other file: [file name](/absolute/path/to/document.pdf)

Rules:
1. Reference only an absolute path to a regular local file that already exists.
2. Do not reference symbolic links, directories, remote URLs, or files larger than 100 MiB.
3. The channel transport extracts valid local file references and sends them as structured attachments.
4. Text and multiple attachments may be returned together.
</im_media_capabilities>`;
}
