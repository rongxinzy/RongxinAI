import type Database from 'better-sqlite3';

import {
  CodingEventWindowPageSize,
  type CodingEvent,
  type CodingEventPage,
  type CodingEventWindow,
} from '../../shared/codingAgent';

const rowEvent = (row: Record<string, unknown>): CodingEvent => ({
  id: String(row.id),
  laneId: String(row.lane_id),
  sequence: Number(row.sequence),
  kind: row.kind as CodingEvent['kind'],
  payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
  createdAt: Number(row.created_at),
});

export class CodingEventWindowReader {
  constructor(private readonly db: Database.Database) {}

  listRecent(laneIds: string[], pageSize = CodingEventWindowPageSize): {
    events: CodingEvent[];
    windows: CodingEventWindow[];
  } {
    const events: CodingEvent[] = [];
    const windows: CodingEventWindow[] = [];
    for (const laneId of laneIds) {
      const rows = this.db
        .prepare(
          `SELECT * FROM coding_events
           WHERE lane_id = ?
           ORDER BY sequence DESC
           LIMIT ?`,
        )
        .all(laneId, pageSize + 1) as Record<string, unknown>[];
      const hasMore = rows.length > pageSize;
      const laneEvents = rows.slice(0, pageSize).map(rowEvent).reverse();
      events.push(...laneEvents);
      windows.push({
        laneId,
        oldestSequence: laneEvents[0]?.sequence ?? null,
        newestSequence: laneEvents.at(-1)?.sequence ?? null,
        hasMore,
      });
    }
    events.sort((left, right) =>
      left.laneId === right.laneId
        ? left.sequence - right.sequence
        : left.laneId.localeCompare(right.laneId),
    );
    return { events, windows };
  }

  loadPage(
    laneId: string,
    beforeSequence: number | null,
    pageSize = CodingEventWindowPageSize,
  ): CodingEventPage {
    const rows =
      beforeSequence === null
        ? (this.db
            .prepare(
              `SELECT * FROM coding_events
               WHERE lane_id = ?
               ORDER BY sequence DESC
               LIMIT ?`,
            )
            .all(laneId, pageSize + 1) as Record<string, unknown>[])
        : (this.db
            .prepare(
              `SELECT * FROM coding_events
               WHERE lane_id = ? AND sequence < ?
               ORDER BY sequence DESC
               LIMIT ?`,
            )
            .all(laneId, beforeSequence, pageSize + 1) as Record<string, unknown>[]);
    const hasMore = rows.length > pageSize;
    const events = rows.slice(0, pageSize).map(rowEvent).reverse();
    return {
      laneId,
      events,
      hasMore,
      nextCursor: hasMore ? events[0]?.sequence ?? null : null,
    };
  }
}
