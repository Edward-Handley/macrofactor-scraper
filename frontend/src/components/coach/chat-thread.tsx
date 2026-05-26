import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import type { CoachConversationWithMessages, CoachMessage } from "../../lib/types";

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <p key={i} className="font-bold text-zinc-100 mt-2">{line.slice(4)}</p>;
        if (line.startsWith("## ")) return <p key={i} className="font-bold text-zinc-100 mt-2">{line.slice(3)}</p>;
        if (line.startsWith("# ")) return <p key={i} className="font-bold text-zinc-100 mt-2">{line.slice(2)}</p>;
        if (line.startsWith("- ") || line.startsWith("• ")) return <p key={i} className="pl-3 before:content-['•'] before:mr-2 before:text-zinc-500">{line.slice(2)}</p>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

function Message({ msg }: { msg: CoachMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center mr-2 mt-0.5 shrink-0 text-xs font-bold text-white">C</div>
      )}
      <div
        className={[
          "max-w-[80%] px-4 py-2.5 rounded-2xl text-sm",
          isUser
            ? "bg-violet-600 text-white rounded-br-sm"
            : "bg-zinc-800 text-zinc-200 rounded-bl-sm",
        ].join(" ")}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <SimpleMarkdown text={msg.content} />
        )}
      </div>
    </div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center mr-2 mt-0.5 shrink-0 text-xs font-bold text-white">C</div>
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-bl-sm bg-zinc-800 text-zinc-200 text-sm">
        {text ? <SimpleMarkdown text={text} /> : (
          <div className="flex gap-1 items-center h-4">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>
    </div>
  );
}

interface ChatThreadProps {
  conversation: CoachConversationWithMessages;
  onDeleted?: () => void;
}

export function ChatThread({ conversation, onDeleted }: ChatThreadProps) {
  const [messages, setMessages] = useState<CoachMessage[]>(conversation.messages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    setMessages(conversation.messages);
  }, [conversation.id, conversation.messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    const userMsg: CoachMessage = {
      id: Date.now(),
      conversation_id: conversation.id,
      role: "user",
      content: text,
      tokens_used: null,
      model: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await api.coachChat.streamMessage(
        conversation.id,
        text,
        (delta) => setStreamBuffer((prev) => prev + delta),
        (tokens) => {
          setStreaming(false);
          setStreamBuffer((buf) => {
            const assistantMsg: CoachMessage = {
              id: Date.now() + 1,
              conversation_id: conversation.id,
              role: "assistant",
              content: buf,
              tokens_used: tokens,
              model: "claude-haiku-4-5-20251001",
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            return "";
          });
          qc.invalidateQueries({ queryKey: ["coach-conversation", conversation.id] });
          qc.invalidateQueries({ queryKey: ["coach-conversations"] });
        },
        (msg) => {
          setError(msg);
          setStreaming(false);
          setStreamBuffer("");
        },
        ctrl.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError("Connection error — please try again.");
      }
      setStreaming(false);
      setStreamBuffer("");
    }
  }, [input, streaming, conversation.id, qc]);

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamBuffer((buf) => {
      if (buf) {
        const assistantMsg: CoachMessage = {
          id: Date.now() + 1,
          conversation_id: conversation.id,
          role: "assistant",
          content: buf + " *(stopped)*",
          tokens_used: null,
          model: null,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
      return "";
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleDelete = async () => {
    await api.coachChat.archive(conversation.id);
    qc.invalidateQueries({ queryKey: ["coach-conversations"] });
    onDeleted?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div>
          <p className="text-sm font-semibold text-zinc-100 truncate">{conversation.title}</p>
          {conversation.for_date && (
            <p className="text-xs text-zinc-500">{conversation.for_date}</p>
          )}
        </div>
        <button
          onClick={handleDelete}
          className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          title="Archive conversation"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.filter((m) => m.role !== "system").length === 0 && !streaming && (
          <div className="flex justify-center items-center h-32">
            <p className="text-sm text-zinc-600 text-center">Your health data is loaded.<br />Ask me anything about your nutrition, recovery, or training.</p>
          </div>
        )}
        {messages.filter((m) => m.role !== "system").map((msg) => (
          <Message key={msg.id} msg={msg} />
        ))}
        {(streaming || streamBuffer) && <StreamingBubble text={streamBuffer} />}
        {error && (
          <div className="flex justify-center">
            <p className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-zinc-800">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={streaming}
            placeholder="Ask about your data… (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none disabled:opacity-50"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          {streaming ? (
            <button
              onClick={stop}
              className="p-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors shrink-0"
              title="Stop"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim()}
              className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors shrink-0"
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-zinc-700 mt-1.5">Powered by Claude Haiku · Rate limited to 3 requests/10 min</p>
      </div>
    </div>
  );
}
