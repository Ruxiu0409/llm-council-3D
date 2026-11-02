import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import CouncilView from './components/CouncilView';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(
    () => new URLSearchParams(window.location.search).get('c')
  );
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [council, setCouncil] = useState(null);
  const watchControllerRef = useRef(null);

  // Load conversations and the council roster on mount
  useEffect(() => {
    loadConversations();
    api.getCouncil()
      .then(setCouncil)
      .catch((error) => console.error('Failed to load council:', error));
  }, []);

  // Load conversation details when selected, and stop watching on switch
  useEffect(() => {
    if (!currentConversationId) return;
    const url = new URL(window.location);
    url.searchParams.set('c', currentConversationId);
    window.history.replaceState(null, '', url);
    const controller = new AbortController();
    loadConversation(currentConversationId, controller.signal);
    return () => {
      controller.abort();
      watchControllerRef.current?.abort();
    };
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id, signal) => {
    try {
      const conv = await api.getConversation(id);
      if (signal.aborted) return;
      setCurrentConversation(conv);
      // A trailing user message means the council may still be deliberating
      // (e.g. a run started by the CLI); attach to it to watch live.
      if (conv.messages.at(-1)?.role === 'user') {
        watchRun(id);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  // Apply fn to a copy of the last (assistant) message of conversation id.
  const updateLastMessage = (id, fn) => {
    setCurrentConversation((prev) => {
      if (!prev || prev.id !== id) return prev;
      const messages = [...prev.messages];
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = fn({ ...last, loading: { ...last.loading } });
      return { ...prev, messages };
    });
  };

  const handleCouncilEvent = (id, eventType, event) => {
    const answered = (msg, model) => ({
      ...msg,
      pending: (msg.pending || []).filter((m) => m !== model),
    });

    switch (eventType) {
      case 'stage0_start':
        updateLastMessage(id, (msg) => {
          msg.loading.stage0 = true;
          msg.pending = event.members;
          msg.metadata = { ...msg.metadata, settings: event.settings };
          return msg;
        });
        break;

      case 'stage0_complete':
        updateLastMessage(id, (msg) => {
          msg.metadata = { ...msg.metadata, plan: event.data };
          msg.loading.stage0 = false;
          msg.pending = [];
          return msg;
        });
        break;

      case 'stage1_start':
        updateLastMessage(id, (msg) => {
          msg.loading.stage1 = true;
          msg.pending = event.members;
          return msg;
        });
        break;

      case 'stage1_response':
        updateLastMessage(id, (msg) => ({
          ...answered(msg, event.data.model),
          stage1: [...(msg.stage1 || []), event.data],
        }));
        break;

      case 'stage1_complete':
        updateLastMessage(id, (msg) => {
          msg.stage1 = event.data;
          msg.loading.stage1 = false;
          return msg;
        });
        break;

      case 'stage2_start':
        updateLastMessage(id, (msg) => {
          msg.loading.stage2 = true;
          msg.pending = event.members;
          msg.metadata = { ...msg.metadata, ...event.metadata };
          return msg;
        });
        break;

      case 'stage2_ranking':
        updateLastMessage(id, (msg) => ({
          ...answered(msg, event.data.model),
          stage2: [...(msg.stage2 || []), event.data],
        }));
        break;

      case 'stage2_complete':
        updateLastMessage(id, (msg) => {
          msg.stage2 = event.data;
          msg.metadata = { ...msg.metadata, ...event.metadata };
          msg.loading.stage2 = false;
          return msg;
        });
        break;

      case 'stage3_start':
        updateLastMessage(id, (msg) => {
          msg.loading.stage3 = true;
          msg.pending = event.members;
          return msg;
        });
        break;

      case 'stage3_complete':
        updateLastMessage(id, (msg) => {
          msg.stage3 = event.data;
          msg.loading.stage3 = false;
          msg.pending = [];
          return msg;
        });
        break;

      case 'title_complete':
        // Reload conversations to get updated title
        loadConversations();
        break;

      case 'complete':
        // Stream complete, reload conversations list
        loadConversations();
        setIsLoading(false);
        break;

      case 'error':
        console.error('Stream error:', event.message);
        updateLastMessage(id, (msg) => ({
          ...msg,
          loading: { stage0: false, stage1: false, stage2: false, stage3: false },
          pending: [],
          error: event.message,
        }));
        setIsLoading(false);
        break;

      default:
        console.log('Unknown event type:', eventType);
    }
  };

  // Follow the council run for a conversation, replaying it from the start
  // into a fresh assistant message.
  const watchRun = async (id) => {
    watchControllerRef.current?.abort();
    const controller = new AbortController();
    watchControllerRef.current = controller;

    const assistantMessage = {
      role: 'assistant',
      stage1: null,
      stage2: null,
      stage3: null,
      metadata: null,
      pending: [],
      loading: {
        stage0: false,
        stage1: false,
        stage2: false,
        stage3: false,
      },
    };
    setCurrentConversation((prev) =>
      prev && prev.id === id
        ? { ...prev, messages: [...prev.messages, assistantMessage] }
        : prev
    );

    setIsLoading(true);
    try {
      const found = await api.watchConversation(
        id,
        (eventType, event) => handleCouncilEvent(id, eventType, event),
        controller.signal
      );
      if (!found) {
        // No run on the server (e.g. it restarted mid-run): drop the placeholder
        setCurrentConversation((prev) =>
          prev && prev.id === id
            ? { ...prev, messages: prev.messages.slice(0, -1) }
            : prev
        );
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to watch council:', error);
      }
    } finally {
      if (watchControllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  };

  const handleSendMessage = async (content, settings) => {
    if (!currentConversationId) return;
    const id = currentConversationId;

    setIsLoading(true);
    try {
      await api.startRun(id, content, settings);
      // Optimistically add user message to UI
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, { role: 'user', content }],
      }));
      await watchRun(id);
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />
      <CouncilView
        key={currentConversation?.id ?? 'none'}
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        council={council}
      />
    </div>
  );
}

export default App;
