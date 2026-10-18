/**
 * Todo IPC contracts (channel + args + result), single source of truth for
 * `src/main/todo/ipc.ts` handlers, the `todo` preload namespace, and the
 * renderer `TodoApi` types.
 *
 * The arg schemas encode the same acceptance rules the hand-written parsers in
 * `todo/ipc.ts` enforced: non-empty trimmed titles/ids, finite timestamps or
 * null, and partial update semantics (absent keys stay absent).
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import { TodoIpc, TodoStatus, TodoView } from '../todo';

/** Non-empty trimmed text, matching `requiredText` in the old ipc.ts parsers. */
const RequiredText = z.string().refine(value => value.trim().length > 0, {
  message: 'must be a non-empty string.',
});

const OptionalText = z.string().optional();

const OptionalNullableId = z.string().nullable().optional();

const OptionalTimestamp = z
  .number()
  .refine(Number.isFinite, { message: 'must be a finite timestamp or null.' })
  .nullable()
  .optional();

/** Mirrors TodoListInput; `view` is required, the rest filters. */
const TodoListInputSchema = z.object({
  view: z.enum([
    TodoView.MyDay,
    TodoView.Important,
    TodoView.Planned,
    TodoView.All,
    TodoView.Completed,
  ]),
  listId: OptionalNullableId,
  query: OptionalText,
  referenceDate: OptionalText,
});

/** Mirrors TodoCreateInput (sourceType/sourceId are set by main, not sent). */
const TodoCreateInputSchema = z.object({
  title: RequiredText,
  note: OptionalText,
  important: z.boolean().optional(),
  dueAt: OptionalTimestamp,
  remindAt: OptionalTimestamp,
  listId: OptionalNullableId,
  myDayDate: z.string().nullable().optional(),
});

/** Partial update: only the keys present are applied. */
const TodoUpdateInputSchema = z
  .object({
    todoId: RequiredText,
    title: RequiredText.optional(),
    note: OptionalText,
    status: z.enum([TodoStatus.Active, TodoStatus.Completed]).optional(),
    important: z.boolean().optional(),
    dueAt: OptionalTimestamp,
    remindAt: OptionalTimestamp,
    listId: OptionalNullableId,
    myDayDate: z.string().nullable().optional(),
  })
  .strict();

const TodoStepCreateInputSchema = z.object({
  todoId: RequiredText,
  title: RequiredText,
});

const TodoStepUpdateInputSchema = z.object({
  id: RequiredText,
  title: RequiredText.optional(),
  completed: z.boolean().optional(),
  order: z.number().int().nonnegative().optional(),
});

/**
 * Result envelope matching the shared `Todo*Result` interfaces: `success` is a
 * plain boolean (not a literal) so the interfaces that re-pin the rows stay
 * assignable, and rows pass through untouched via `passthrough`.
 */
const SuccessEnvelope = <T extends z.ZodRawShape>(data: T) =>
  z
    .object({
      success: z.boolean(),
      error: z.string().optional(),
      ...data,
    })
    .passthrough();

export const todoContract = defineIpcContract({
  list: {
    channel: TodoIpc.List,
    args: z.tuple([TodoListInputSchema]),
    result: SuccessEnvelope({ todos: z.array(z.unknown()).optional() }),
  },
  create: {
    channel: TodoIpc.Create,
    args: z.tuple([TodoCreateInputSchema]),
    result: SuccessEnvelope({ todo: z.unknown().optional() }),
  },
  update: {
    channel: TodoIpc.Update,
    args: z.tuple([TodoUpdateInputSchema]),
    result: SuccessEnvelope({ todo: z.unknown().optional() }),
  },
  delete: {
    channel: TodoIpc.Delete,
    args: z.tuple([RequiredText]),
    result: SuccessEnvelope({}),
  },
  listLists: {
    channel: TodoIpc.ListLists,
    args: z.tuple([]),
    result: SuccessEnvelope({ lists: z.array(z.unknown()).optional() }),
  },
  createList: {
    channel: TodoIpc.CreateList,
    args: z.tuple([z.object({ name: RequiredText }).strict()]),
    result: SuccessEnvelope({ list: z.unknown().optional() }),
  },
  updateList: {
    channel: TodoIpc.UpdateList,
    args: z.tuple([z.object({ listId: RequiredText, name: RequiredText }).strict()]),
    result: SuccessEnvelope({ list: z.unknown().optional() }),
  },
  deleteList: {
    channel: TodoIpc.DeleteList,
    args: z.tuple([RequiredText]),
    result: SuccessEnvelope({}),
  },
  createStep: {
    channel: TodoIpc.CreateStep,
    args: z.tuple([TodoStepCreateInputSchema]),
    result: SuccessEnvelope({ step: z.unknown().optional() }),
  },
  updateStep: {
    channel: TodoIpc.UpdateStep,
    args: z.tuple([TodoStepUpdateInputSchema]),
    result: SuccessEnvelope({ step: z.unknown().optional() }),
  },
  deleteStep: {
    channel: TodoIpc.DeleteStep,
    args: z.tuple([RequiredText]),
    result: SuccessEnvelope({}),
  },
});
