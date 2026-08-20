export const CoworkUiEvent = {
  OpenShareOptions: 'cowork:open-share-options',
} as const;

export type CoworkUiEvent = (typeof CoworkUiEvent)[keyof typeof CoworkUiEvent];

export const CoworkSessionView = {
  Conversation: 'conversation',
  Trace: 'trace',
} as const;

export type CoworkSessionView = (typeof CoworkSessionView)[keyof typeof CoworkSessionView];

export const isCoworkSessionView = (value: unknown): value is CoworkSessionView =>
  Object.values(CoworkSessionView).includes(value as CoworkSessionView);

export interface CoworkOpenShareOptionsEventDetail {
  sessionId: string;
}

export const CoworkAttachmentMediaType = {
  Binary: 'application/octet-stream',
  GenericImage: 'image/*',
} as const;

export const CoworkAttachmentMediaTypeByExtension: Readonly<Record<string, string>> = {
  bmp: 'image/bmp',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  svg: 'image/svg+xml',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
};
