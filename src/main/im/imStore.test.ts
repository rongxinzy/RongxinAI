import { expect,test } from 'vitest';

import { IMStore } from './imStore';

class FakeDb {
  private store: Map<string, string> = new Map();
  private mappings: Map<string, {
    im_conversation_id: string;
    platform: string;
    cowork_session_id: string;
    agent_id: string;
    openclaw_session_key: string | null;
    created_at: number;
    last_active_at: number;
  }> = new Map();
  private deletedPlatforms: string[] = [];
  writeCount = 0;

  pragma(_name: string) {
    // Report migrated columns as already present to skip ALTER TABLE migrations.
    return [{ name: 'agent_id' }, { name: 'openclaw_session_key' }];
  }

  prepare(sql: string) {
    return {
      run: (...params: unknown[]) => {
        if (sql.includes('INSERT') && sql.includes('im_config')) {
          this.store.set(String(params[0]), String(params[1]));
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE im_config')) {
          // UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?
          this.store.set(String(params[2]), String(params[0]));
          this.writeCount++;
          return;
        }
        if (sql.includes('DELETE FROM im_config WHERE key = ?')) {
          this.store.delete(String(params[0]));
          this.writeCount++;
          return;
        }
        if (sql.includes('INSERT INTO im_session_mappings')) {
          const row = {
            im_conversation_id: String(params[0]),
            platform: String(params[1]),
            cowork_session_id: String(params[2]),
            agent_id: String(params[3]),
            openclaw_session_key: params[4] ? String(params[4]) : null,
            created_at: Number(params[5]),
            last_active_at: Number(params[6]),
          };
          this.mappings.set(this.mappingKey(row.im_conversation_id, row.platform), row);
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE im_session_mappings SET openclaw_session_key = ?')) {
          const key = this.mappingKey(String(params[2]), String(params[3]));
          const row = this.mappings.get(key);
          if (row) {
            row.openclaw_session_key = String(params[0]);
            row.last_active_at = Number(params[1]);
          }
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE im_session_mappings SET cowork_session_id = ?')) {
          const key = this.mappingKey(String(params[4]), String(params[5]));
          const row = this.mappings.get(key);
          if (row) {
            row.cowork_session_id = String(params[0]);
            row.agent_id = String(params[1]);
            if (params[2]) {
              row.openclaw_session_key = String(params[2]);
            }
            row.last_active_at = Number(params[3]);
          }
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE im_session_mappings SET last_active_at = ?')) {
          const key = this.mappingKey(String(params[1]), String(params[2]));
          const row = this.mappings.get(key);
          if (row) {
            row.last_active_at = Number(params[0]);
          }
          this.writeCount++;
          return;
        }
        if (sql.includes('DELETE FROM im_session_mappings WHERE im_conversation_id = ?')) {
          this.mappings.delete(this.mappingKey(String(params[0]), String(params[1])));
          this.writeCount++;
          return;
        }
        if (sql.includes('DELETE FROM im_session_mappings WHERE cowork_session_id = ?')) {
          const target = String(params[0]);
          for (const [key, row] of this.mappings.entries()) {
            if (row.cowork_session_id === target) {
              this.mappings.delete(key);
            }
          }
          this.writeCount++;
          return;
        }
        // CREATE TABLE, ALTER TABLE, etc: count as write
        this.writeCount++;
      },
      get: (...params: unknown[]) => {
        if (sql.includes('SELECT value FROM im_config WHERE key = ?')) {
          const value = this.store.get(String(params[0]));
          return value !== undefined ? { value } : undefined;
        }
        if (sql.includes('FROM im_session_mappings WHERE im_conversation_id = ?')) {
          return this.mappings.get(this.mappingKey(String(params[0]), String(params[1])));
        }
        if (sql.includes('FROM im_session_mappings WHERE cowork_session_id = ?')) {
          const target = String(params[0]);
          return Array.from(this.mappings.values()).find(row => row.cowork_session_id === target);
        }
        return undefined;
      },
      all: (...params: unknown[]) => {
        if (sql.includes('SELECT key, value FROM im_config WHERE key LIKE ?')) {
          const prefix = String(params[0]).replace('%', '');
          return Array.from(this.store.entries())
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value }));
        }
        return [];
      },
    };
  }

  private mappingKey(imConversationId: string, platform: string) {
    return `${platform}\0${imConversationId}`;
  }

  getValue(key: string) {
    return this.store.get(key);
  }

  getDeletedPlatforms() {
    return this.deletedPlatforms;
  }
}

test('IMStore persists conversation reply routes by platform and conversation ID', () => {
  const db = new FakeDb();
  const store = new IMStore(db as unknown as ConstructorParameters<typeof IMStore>[0]);

  expect(store.getConversationReplyRoute('dingtalk', '__default__:conv-1')).toBe(null);

  store.setConversationReplyRoute('dingtalk', '__default__:conv-1', {
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });

  expect(store.getConversationReplyRoute('dingtalk', '__default__:conv-1')).toEqual({
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });
  expect(store.getConversationReplyRoute('telegram', '__default__:conv-1')).toBe(null);
  expect(db.writeCount >= 2).toBeTruthy();
});

test('IMStore persists OpenClaw session keys in IM session mappings', () => {
  const db = new FakeDb();
  const store = new IMStore(db as unknown as ConstructorParameters<typeof IMStore>[0]);

  store.createSessionMapping(
    'bot-1:direct:user-1',
    'weixin',
    'cowork-1',
    'main',
    'agent:main:openclaw-weixin:bot-1:direct:user-1',
  );

  expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')).toMatchObject({
    imConversationId: 'bot-1:direct:user-1',
    platform: 'weixin',
    coworkSessionId: 'cowork-1',
    agentId: 'main',
    openClawSessionKey: 'agent:main:openclaw-weixin:bot-1:direct:user-1',
  });
  expect(store.getSessionMappingByCoworkSessionId('cowork-1')?.openClawSessionKey)
    .toBe('agent:main:openclaw-weixin:bot-1:direct:user-1');

  store.updateSessionOpenClawSessionKey(
    'bot-1:direct:user-1',
    'weixin',
    'agent:main:openclaw-weixin:bot-1:direct:user-2',
  );

  expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')?.openClawSessionKey)
    .toBe('agent:main:openclaw-weixin:bot-1:direct:user-2');

  store.updateSessionMappingTarget(
    'bot-1:direct:user-1',
    'weixin',
    'cowork-2',
    'agent-2',
    'agent:agent-2:openclaw-weixin:bot-1:direct:user-1',
  );

  expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')).toMatchObject({
    coworkSessionId: 'cowork-2',
    agentId: 'agent-2',
    openClawSessionKey: 'agent:agent-2:openclaw-weixin:bot-1:direct:user-1',
  });
});

