import assert from 'node:assert/strict';

const clickBinding = '__zhiyuanAcceptanceObservedClick';

// Observation only: no DOM writes, event cancellation or synthetic UI input.
export const clickObserverExpression = `document.addEventListener('click', event => {
  try {
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest('button, [role="checkbox"], a') || target;
    globalThis.${clickBinding}(JSON.stringify({
      isTrusted: event.isTrusted, targetId: target?.id || '', actionId: action?.id || '',
      x: event.clientX, y: event.clientY, button: event.button,
      defaultPrevented: event.defaultPrevented, timestamp: event.timeStamp,
      page: document.querySelector('.page.active')?.id || ''
    }));
  } catch { /* Diagnostics must not interfere with the real click handler. */ }
}, { capture: true, passive: true })`;

export function browserObservation(event) {
  if (event.method === 'Runtime.exceptionThrown')
    return { kind: 'exception', details: event.params.exceptionDetails };
  if (event.method !== 'Runtime.bindingCalled' || event.params.name !== clickBinding) return null;
  try {
    return { kind: 'click', details: JSON.parse(event.params.payload) };
  } catch {
    return { kind: 'diagnostic-error', message: 'Invalid observed click payload' };
  }
}

export class Cdp {
  next = 0;
  pending = new Map();
  observations = [];
  droppedObservations = 0;
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const result = JSON.parse(event.data);
      if (result.method) {
        const observation = browserObservation(result);
        if (observation) {
          if (this.observations.length < 500)
            this.observations.push({ receivedAt: new Date().toISOString(), ...observation });
          else this.droppedObservations++;
        }
        return;
      }
      const pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id);
      clearTimeout(pending.timer);
      if (result.error) pending.reject(new Error(JSON.stringify(result.error)));
      else pending.resolve(result.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebView2 disconnected'));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    assert.equal(new URL(url).hostname, '127.0.0.1', 'CDP must remain on loopback');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async observeClicks() {
    await this.send('Runtime.addBinding', { name: clickBinding });
    await this.evaluate(clickObserverExpression);
  }
  close() {
    this.socket.close();
  }
}
