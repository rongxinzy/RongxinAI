export interface ImageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
}

export interface ChatUserMessageInput {
  content: string;
  images?: ImageAttachment[];
}
