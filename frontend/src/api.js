/**
 * API client for the LLM Council backend.
 */

// In dev (Vite on :5173) talk to the backend directly; when the backend serves
// the built frontend, use the same origin.
const API_BASE = import.meta.env.DEV ? 'http://localhost:8001' : '';

/**
 * Read a Server-Sent Events response, calling onEvent for each event.
 * Buffers across chunks so large events split by the network still parse.
 */
async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();

    for (const block of events) {
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  }
}

export const api = {
  /**
   * The model pool, planner, and chairman.
   */
  async getCouncil() {
    const response = await fetch(`${API_BASE}/api/council`);
    if (!response.ok) {
      throw new Error('Failed to load council');
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Start the council on a message in the background.
   * Follow its progress with watchConversation.
   */
  async startRun(conversationId, content, settings = {}) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/runs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, ...settings }),
      }
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail || 'Failed to send message');
    }
    return response.json();
  },

  /**
   * Follow a council run that may have been started elsewhere (e.g. the CLI).
   * Replays all events so far. Resolves to false if there is no run to watch.
   */
  async watchConversation(conversationId, onEvent, signal) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/live`,
      { signal }
    );
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error('Failed to watch conversation');
    }
    await readEvents(response, onEvent);
    return true;
  },
};
