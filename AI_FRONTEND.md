# AI_FRONTEND.md – Vite + React + TypeScript

## 1. Tech Stack

- **Build tool:** Vite
- **UI:** React (functional components + hooks)
- **Language:** TypeScript (`"strict": true`)
- **HTTP / API:** `fetch` or `axios` wrapped in a typed client layer
- **State:** React hooks (local), plus a small global store if really needed (e.g. Zustand/Redux Toolkit)
- **Styling:** Any of
  - CSS Modules / SASS modules, or
  - TailwindCSS
- **Testing:** Vitest + React Testing Library

> Goal: predictable, type-safe, maintainable frontend for AI/REST/WS-heavy apps.

---

## 2. Project Structure

Use a clear, feature-oriented structure:

```text
src/
  app/              # App shell, routing, global providers
  features/         # Feature modules (per domain)
    chat/
      components/
      hooks/
      services/
      types.ts
      index.ts
    dashboard/
      ...
  components/       # Truly shared UI components (buttons, layout, inputs)
  services/         # Cross-feature API clients, WebSocket clients, auth
  hooks/            # Generic shared hooks (useWindowSize, useDebounce, etc.)
  types/            # Global types (API models, enums)
  styles/           # Global styles, design tokens, Tailwind config etc.
  config/           # App config, env parsing
  main.tsx
  vite-env.d.ts
````

**Rules:**

* Features should be **independent** as much as possible.
* Shared components go to `src/components`, not copied between features.
* Avoid “god” folders like `utils/` with everything mixed in – group by domain/feature.

---

## 3. General Conventions

* Use **TypeScript strictly**:

  * `"strict": true`, no implicit `any`.
  * Prefer **explicit types** for props, API responses, and hooks.
* Use **ESLint + Prettier** and keep the repo lint-clean.
* Use **functional components only** (no class components).
* Prefer React hooks for all side effects: `useEffect`, `useMemo`, `useCallback`, `useRef`.

**File size:**

* Soft limit: **≤ 300 lines per component file**.
* Hard limit: **≤ 800 lines per file** (including hooks, services, etc.).
* If you exceed limits: split into smaller components/modules.

---

## 4. Components

### 4.1 Component Types

* **Presentational / UI components**

  * No business logic / API calls.
  * Receive data via props.
  * Go into `components/` or `features/<x>/components/`.

* **Container / feature components**

  * Handle data fetching, feature-specific state, orchestration.
  * Live in `features/<x>/`.

### 4.2 Component Rules

* Props must be typed with `interface` or `type`:

  ```ts
  interface ChatMessageProps {
    author: "user" | "assistant";
    text: string;
    timestamp: string;
  }
  ```
* No direct access to `window` / `document` in the body:

  * Use `useEffect` or guards (`typeof window !== "undefined"`).
* Side effects (API calls, subscriptions) must be inside hooks, not in render path.

---

## 5. State Management

### 5.1 Local vs Global

* Use **local state** (`useState`, `useReducer`) when the state:

  * is used only in one component or a small subtree;
  * is not needed across routes/features.

* Use a **global store** (e.g. Zustand/Redux Toolkit) only when:

  * multiple unrelated features need the same data (auth, user profile, theme);
  * the same state must be synchronized across many routes/components.

### 5.2 State Rules

* Avoid deeply nested global state; prefer composition of smaller slices.
* Derived data → `useMemo` or selectors, not recomputed on every render.
* For server state (data from backend/AI):

  * Consider a data fetching library (e.g. React Query) or build a small custom layer.
  * Never store raw server state and local UI state together in a messy, monolithic object.

---

## 6. API & AI Calls

### 6.1 API Client Layer

All network logic must live **outside components**:

```ts
// services/apiClient.ts
export interface ApiConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class ApiClient {
  constructor(private config: ApiConfig) {}

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  async post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<TRes>;
  }
}
```

* Components call **typed services**, not `fetch`/`axios` directly.
* Each feature can have a service module (e.g. `features/chat/services/chatApi.ts`).

### 6.2 AI/LLM & Streaming

* For streaming responses (SSE / chunked text):

  * Create a dedicated service (`streamChatCompletion`).
  * Use a hook `useChatStream` that encapsulates:

    * connection lifecycle,
    * abort/cancel logic,
    * error handling.

* UI for AI calls **must always** expose:

  * loading state (spinner, skeleton, “thinking…”),
  * intermediate updates for streaming,
  * clear error message in case of failure.

### 6.3 Error Handling

* Do not show raw error messages from backend.
* Map technical errors → user-friendly messages:

  * network issues → “Connection problem, please retry.”
  * 4xx → validation or usage error with human text.
* Log detailed errors to the console (dev) or monitoring (prod), not to the user.

---

## 7. Styling & Layout

### 7.1 Brand Guidelines (sqowe)

**IMPORTANT:** All UI/design work MUST follow the sqowe brand design system.

* **Authoritative source:** `AI_WEB_DESIGN_SQOWE.md`
* **Color palette:** Dark Ground (#222222), Light Purple (#8E88A3), Dark Purple (#5B5377), Light Grey (#B2B3B2)
* **Typography:** Montserrat font family (Light 300, Regular 400, Medium 500, Bold 700)
* **Components:** Use predefined button styles, card patterns, navigation, forms, hero sections
* **Accessibility:** Ensure WCAG AA compliance with approved color combinations

**Before implementing UI components:**
1. Read `AI_WEB_DESIGN_SQOWE.md` for complete design guidelines
2. Use CSS variables defined in the brandbook
3. Follow Material-inspired component patterns
4. Maintain brand consistency across all interfaces

### 7.2 Styling System

* Prefer one of:

  * **CSS Modules / SASS Modules**, or
  * **TailwindCSS** with sqowe design tokens (colors, spacing, border radius).

**Rules:**

* No large inline styles except for quick one-off adjustments.
* Do not mix multiple styling systems in one feature without reason.
* Keep layout responsive (at least mobile & desktop breakpoints).

---

## 8. Environment & Secrets

* Never hardcode secrets (API keys, tokens) in frontend code.
* Only expose variables that are safe for the client.
* In Vite, use `import.meta.env` with `VITE_` prefix:

  ```ts
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
  ```
* Anything in the frontend bundle is **public**, treat it this way.

---

## 9. Testing

* Use **Vitest** with **React Testing Library**.

### 9.1 What to test

* Critical components:

  * forms, AI interaction UI, dashboards.
* Critical flows:

  * send prompt → show loading → show response;
  * error scenarios (backend down, validation errors).

### 9.2 Example Test

```ts
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatInput } from "./ChatInput";

describe("ChatInput", () => {
  it("submits message and clears input", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const input = screen.getByPlaceholderText(/type your message/i);
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.submit(input.closest("form")!);

    expect(onSend).toHaveBeenCalledWith("Hello");
    expect((input as HTMLInputElement).value).toBe("");
  });
});
```

---

## 10. Accessibility & UX

* Basic accessibility rules:

  * Use semantic HTML (`button`, `label`, `main`, `nav`).
  * Every interactive element must be accessible by keyboard.
  * Inputs must have labels.
* For AI-related UI:

  * Make loading states clear (text + spinner).
  * Allow user to cancel or reset the conversation where applicable.

---

## 11. Performance

* Use `React.memo` for pure presentational components that re-render often.
* Use `useMemo` / `useCallback` only when they **actually** prevent re-renders.
* Avoid heavy synchronous computations in components:

  * move them to workers or backend side.
* Lazy-load large feature modules (code splitting) when appropriate.

---

## 12. Example: Feature Hook + Component

```ts
// features/chat/hooks/useChat.ts
import { useState } from "react";
import { chatService } from "../services/chatService";
import type { ChatMessage } from "../types";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = async (text: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const reply = await chatService.sendMessage(text, messages);
      setMessages((prev) => [...prev, { role: "user", text }, reply]);
    } catch (e) {
      setError("Failed to contact assistant. Please try again.");
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, isLoading, error, sendMessage };
}
```

```tsx
// features/chat/components/ChatPanel.tsx
import React from "react";
import { useChat } from "../hooks/useChat";

export const ChatPanel: React.FC = () => {
  const { messages, isLoading, error, sendMessage } = useChat();
  const [input, setInput] = React.useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    void sendMessage(input.trim());
    setInput("");
  };

  return (
    <div className="chat-panel">
      <div className="messages">
        {messages.map((m, idx) => (
          <div key={idx} className={`msg msg--${m.role}`}>
            {m.text}
          </div>
        ))}
        {isLoading && <div className="msg msg--assistant">Thinking…</div>}
      </div>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onSubmit} className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message…"
        />
        <button type="submit" disabled={isLoading}>
          Send
        </button>
      </form>
    </div>
  );
};
```

---

## 13. Summary

* Use **Vite + React + TypeScript** with strict typing.
* Keep **logic in hooks/services**, not in UI.
* All network/AI calls go through **typed service modules**.
* Enforce **file size limits** and a **feature-oriented structure**.
* UX for AI interactions must always handle **loading, errors, and streaming** clearly.

This document is the **baseline rule set** for any new frontend project in this stack.
