import { CompanionMemoryTool } from '../../src/main/companion/constants.ts';
import { MemoryKind } from '../../src/shared/memory/constants.ts';

/** Synthetic protocol fixture, not a claim about a real model's memory judgment. */
export function createChatMemoryFixture() {
  const requested = new Set();
  const results = [];
  let savedId;
  return {
    results,
    nextCall(payload) {
      const last = payload.messages.at(-1);
      const prompt = String(payload.messages.findLast(message => message.role === 'user')?.content);
      if (last.role === 'tool') {
        const result = JSON.parse(last.content);
        results.push({ prompt, result });
        if (result.id && result.available) savedId = result.id;
        return null;
      }
      if (requested.has(prompt)) return null;
      requested.add(prompt);
      const tools = payload.tools.map(tool => tool.function.name);
      if (!Object.values(CompanionMemoryTool).every(name => tools.includes(name)))
        throw new Error('Companion private memory tools missing from native model request');
      const fact = {
        title: 'Paper kite',
        content: 'The paper kite is blue.',
        kind: MemoryKind.Preference,
      };
      const name =
        prompt.includes('remember-kite') || prompt.includes('correct-kite')
          ? CompanionMemoryTool.Save
          : prompt.includes('forget-kite')
            ? CompanionMemoryTool.Forget
            : CompanionMemoryTool.Search;
      const args =
        name === CompanionMemoryTool.Forget
          ? { id: savedId }
          : name === CompanionMemoryTool.Search
            ? { query: 'paper kite' }
            : prompt.includes('correct-kite')
              ? { ...fact, content: 'The paper kite is green.', replacesId: savedId }
              : fact;
      return {
        index: 0,
        id: 'native-reused-call',
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      };
    },
  };
}
