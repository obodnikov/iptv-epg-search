# Claude Chat Export
**Generated: 2026-07-03 10:37:47**

---

👤 **USER:**
> extensions

Let me pull up the extensions documentation for you

Here's an overview of **pi extensions** — TypeScript modules that extend pi's behavior.

### What Extensions Can Do

- **Custom tools** — Register tools the LLM can call via `pi.registerTool()`
- **Event interception** — Block or modify tool calls, inject context, customize compaction
- **User interaction** — Prompts via `ctx.ui` (select, confirm, input, notify)
- **Custom TUI components** — Full terminal UI components via `ctx.ui.custom()`
- **Custom commands** — Register `/mycommand` handlers via `pi.registerCommand()`
- **Session persistence** — Store state surviving restarts via `pi.appendEntry()`
- **Custom rendering** — Control how tool calls/results and messages appear in the TUI

### Locations

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | Global (all projects) |
| `~/.pi/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.pi/extensions/*.ts` | Project-local |
| `.pi/extensions/*/index.ts` | Project-local (subdirectory) |

### Quick Start Example

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // Block dangerous commands
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: `Hello, ${params.name}!` }], details: {} };
    },
  });

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test with: `pi -e ./my-extension.ts`

### Key Events (lifecycle hooks)

- **`tool_call`** / **`tool_result`** — intercept/modify tool execution
- **`input`** — transform or handle user input before agent processing
- **`before_agent_start`** — inject messages or modify the system prompt
- **`context`** — modify messages before each LLM call
- **`session_start`** / **`session_shutdown`** — lifecycle management
- **`session_before_compact`** / **`session_compact`** — custom compaction
- **`model_select`** / **`thinking_level_select`** — react to model/thinking changes

### Available Imports

- `@earendil-works/pi-coding-agent` — Core types (`ExtensionAPI`, `ExtensionContext`, events)
- `typebox` — Schema definitions for tool parameters
- `@earendil-works/pi-ai` — AI utilities
- `@earendil-works/pi-tui` — TUI components for custom rendering
- Any npm package (add `package.json`) or Node.js built-in

### Example Use Cases

- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on branch)
- Path protection (block writes to `.env`, `node_modules/`)
- Custom compaction (summarize conversation your way)
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- Games while you wait (see `snake.ts` example)

---

Would you like me to dive deeper into any specific area — e.g., custom tools, event hooks, UI components, or show you the example extensions?

