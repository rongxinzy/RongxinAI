import type Database from 'better-sqlite3';
import { CompanionRequestState } from '../../shared/companion/constants';
import type { CompanionPreparedImage } from '../../shared/companion/images';
import type {
  CompanionConversation,
  CompanionMessage,
  CompanionProfile,
  CompanionReceipt,
} from '../../shared/companion/types';
import { piCompanionChatSessionId, type PiRuntime } from '../libs/agentEngine/piRuntimeTypes';
import type { MagpieModelService } from '../magpie/modelService';
import { CompanionModelAssignment } from './modelAssignment';
import { companionInstructions } from './personas';
import { interruptPendingCompanionReplies } from './chatPersistence';

interface ImageInput {
  ids: readonly string[];
  resolve(): Promise<CompanionPreparedImage[]>;
}

interface ChatRow extends CompanionReceipt {
  state: CompanionRequestState;
  input: string;
  attachments: string | null;
  text: string;
}

export type CompanionActivity = Pick<CompanionReceipt, 'petId' | 'submissionId'> & {
  state: CompanionRequestState;
};

const CHAT_COLUMNS =
  'pet_id AS petId, request_id AS requestId, submission_id AS submissionId, state, input, attachments, text';

/** Bubble receipts and reply text in the main database. Pi owns the model history. */
export class CompanionChat {
  private readonly assignment: CompanionModelAssignment;
  private readonly listeners = new Set<(activity: CompanionActivity) => void>();
  private closing = false;

  constructor(
    private readonly db: Database.Database,
    models: Pick<MagpieModelService, 'resolveAutomatic'>,
    private readonly runtime: Pick<PiRuntime, 'continueSession' | 'stopSession'>,
  ) {
    this.assignment = new CompanionModelAssignment(models);
  }

  onActivity(listener: (activity: CompanionActivity) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(receipt: CompanionReceipt, state: CompanionRequestState): void {
    const { petId, submissionId } = receipt;
    for (const listener of this.listeners) {
      try {
        listener({ petId, submissionId, state });
      } catch (error) {
        console.warn(`[CompanionChat] Activity listener failed for turn ${submissionId}:`, error);
      }
    }
  }

  private receipt({ petId, requestId, submissionId }: CompanionReceipt): CompanionReceipt {
    return { petId, requestId, submissionId };
  }

  private find(petId: string, requestId: string): ChatRow | undefined {
    return this.db
      .prepare(
        `SELECT ${CHAT_COLUMNS} FROM companion_chat_turns WHERE pet_id = ? AND request_id = ?`,
      )
      .get(petId, requestId) as ChatRow | undefined;
  }

  private pending(petId: string): ChatRow | undefined {
    return this.db
      .prepare(`SELECT ${CHAT_COLUMNS} FROM companion_chat_turns WHERE pet_id = ? AND state = ?`)
      .get(petId, CompanionRequestState.Accepted) as ChatRow | undefined;
  }

  private needsVision(petId: string): boolean {
    return Boolean(
      this.db
        .prepare(`SELECT 1 FROM companion_chat_turns
          WHERE pet_id = ? AND state = ? AND attachments IS NOT NULL LIMIT 1`)
        .get(petId, CompanionRequestState.Answered),
    );
  }

  async availability(profile: CompanionProfile) {
    if (this.needsVision(profile.petId)) {
      const visual = await this.assignment.resolve(true);
      if (visual.modelId) return visual;
    }
    return this.assignment.resolve();
  }

  async submit(
    profile: CompanionProfile,
    requestId: string,
    input: string,
    imageInput?: ImageInput,
  ) {
    const { petId } = profile;
    const text = input.trim();
    const imageIds = new Set(imageInput?.ids);
    if (!text && !imageIds.size) throw new Error('Companion input is empty');
    if (this.closing) throw new Error('Companion chat is closing');

    const previous = this.find(petId, requestId);
    if (previous)
      return { receipt: this.receipt(previous), availability: await this.availability(profile) };
    if (this.pending(petId)) throw new Error('Companion has an unfinished reply');

    const availability = imageIds.size
      ? await this.assignment.resolve(true)
      : await this.availability(profile);
    if (!availability.modelId) return { availability, receipt: null };
    const modelId = availability.modelId;
    const images = imageInput?.ids.length ? await imageInput.resolve() : [];
    if (images.length !== imageIds.size || images.some(image => !imageIds.delete(image.id)))
      throw new Error('Companion image selection changed');
    if (this.closing) throw new Error('Companion chat is closing');

    const existing = this.find(petId, requestId);
    if (existing) return { availability, receipt: this.receipt(existing) };
    if (this.pending(petId)) throw new Error('Companion has an unfinished reply');
    const attachments = images.length ? images.map(({ id, name }) => ({ id, name })) : null;
    const { lastInsertRowid } = this.db
      .prepare(`INSERT INTO companion_chat_turns (pet_id, request_id, state, input, attachments)
        VALUES (?, ?, ?, ?, ?)`)
      .run(
        petId,
        requestId,
        CompanionRequestState.Accepted,
        text,
        attachments && JSON.stringify(attachments),
      );
    const receipt = { petId, requestId, submissionId: Number(lastInsertRowid) };
    const sessionId = piCompanionChatSessionId(petId);
    this.emit(receipt, CompanionRequestState.Accepted);

    void this.runtime
      .continueSession(sessionId, text, {
        companionChat: true,
        systemPrompt: companionInstructions(profile.personaId),
        modelOverride: modelId,
        imageAttachments: images.map(({ name, data, mimeType }) => ({
          name,
          mimeType,
          base64Data: data,
        })),
        onSettled: result => {
          const output = result.ok ? (result.output ?? '') : '';
          if (output.trim()) {
            this.finish(receipt, CompanionRequestState.Answered, output);
          } else if (this.finish(receipt, CompanionRequestState.Unanswered)) {
            this.assignment.failed(modelId);
          }
        },
      })
      .catch(error => {
        if (this.finish(receipt, CompanionRequestState.Unanswered)) {
          console.warn(`[CompanionChat] Failed to run turn ${receipt.submissionId}:`, error);
        }
      });
    return { availability, receipt };
  }

  private finish(receipt: CompanionReceipt, state: CompanionRequestState, text = ''): boolean {
    if (this.closing) return false;
    const result = this.db
      .prepare(
        'UPDATE companion_chat_turns SET state = ?, text = ? WHERE submission_id = ? AND state = ?',
      )
      .run(state, text, receipt.submissionId, CompanionRequestState.Accepted);
    if (result.changes) this.emit(receipt, state);
    return result.changes > 0;
  }

  stop(profile: CompanionProfile): void {
    const row = this.pending(profile.petId);
    if (!row) return;
    this.finish(row, CompanionRequestState.Stopped);
    this.runtime.stopSession(piCompanionChatSessionId(profile.petId), { companionChat: true });
  }

  hasPendingReply(petId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM companion_chat_turns WHERE pet_id = ? AND state = ?')
        .get(petId, CompanionRequestState.Accepted),
    );
  }

  history(profile: CompanionProfile): CompanionConversation {
    const rows = this.db
      .prepare(`SELECT ${CHAT_COLUMNS} FROM companion_chat_turns
        WHERE pet_id = ? ORDER BY submission_id DESC LIMIT 32`)
      .all(profile.petId) as ChatRow[];
    const latest = rows[0];
    const messages: CompanionMessage[] = [];
    for (const row of rows.reverse()) {
      messages.push({
        id: row.submissionId * 2 - 1,
        role: 'user',
        text: row.input,
        ...(row.attachments ? { attachments: JSON.parse(row.attachments) } : {}),
      });
      if (row.text) messages.push({ id: row.submissionId * 2, role: 'assistant', text: row.text });
    }
    return {
      messages: messages.slice(-32),
      pending: latest?.state === CompanionRequestState.Accepted ? this.receipt(latest) : null,
      ...(latest ? { lastReply: { ...this.receipt(latest), state: latest.state } } : {}),
    };
  }

  interrupt(): void {
    this.closing = true;
    interruptPendingCompanionReplies(this.db);
  }
}
