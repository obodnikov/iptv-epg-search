# Claude Chat Export
**Generated: 2026-01-16 21:10:14**

---

👤 **USER:**
> You are acting as a senior software architect and AI coding assistant.

Context:
This is a long-living personal PET project that has evolved over time.
Coding rules and AI behavior are defined in dedicated AI*.md files
and MUST NOT be duplicated or redefined in architecture documents.

Your task is to analyze the repository structure, existing documentation in root and docs/ directories, and previous conversations under docs/chats/ directory,
then create or update ARCHITECTURE.md as an architectural source of truth.

––––––––––––––––––––
IMPORTANT CONSTRAINTS:

- Do NOT redefine coding rules, formatting rules, or stack-specific practices
- Do NOT duplicate content from AI*.md files
- ARCHITECTURE.md must only reference AI*.md files as authoritative sources
- If AI rules are missing for a stack, explicitly mark this as a gap
- Target length: 250-300 lines maximum (enforce brevity)
- Use tmp/ARCHITECT.md as the pattern template (if available)
- Use tmp/ARCHITECTURE_EXAMPLE.md for structure inspiration (if available)

––––––––––––––––––––
YOUR OBJECTIVES:

1. Analyze repository structure and identify architectural components
2. Cross-check existing documentation and identify outdated or conflicting parts
3. Check previous conversations in docs/chats/ for implementation context
4. Document the current architecture as it exists today (not as imagined or planned)
5. Map components to stability zones with emoji markers:
   - ✅ Stable (production-ready, low risk to change)
   - 🔄 Semi-Stable (functional, may evolve)
   - ⚠️ Experimental (working, may be replaced)
   - 🔮 Planned (not yet implemented)
6. Add Section 8: AI Coding Rules with:
   - List of all AI*.md files and their purposes
   - Rule precedence hierarchy (user → stack-specific → global → architecture → conventions)
   - "Stop and ask" conflict resolution process
7. Use ASCII diagrams for data flows (authentication, main business logic)
8. Link to detailed docs (implementation.md, configuration.md) instead of duplicating
9. Keep it scannable: use tables, diagrams, bullet points over prose

––––––––––––––––––––
REQUIRED STRUCTURE (9 sections):

Follow this exact structure:

1. Purpose of This Document (5-10 lines)
   - What it does / doesn't do
   - Audience (AI assistants, new developers)

2. High-Level System Overview (20-30 lines)
   - Project type and characteristics
   - Tech stack summary
   - Architecture pattern as ASCII diagram

3. Repository Structure (30-50 lines)
   - Actual directory tree (not generic)
   - Purpose of each major directory
   - Critical paths (entry points, configs, tests)

4. Core Components (40-60 lines)
   - 4.1 Frontend (if applicable)
   - 4.2 Backend (if applicable)
   - 4.3 Jobs/Automation (if applicable)
   - 4.4 External Integrations

5. Data Flow & Runtime Model (30-50 lines)
   - Authentication flow (ASCII diagram)
   - Main business logic flow (ASCII diagram)
   - Configuration loading hierarchy

6. Configuration & Environment Assumptions (20-30 lines)
   - Environment variables
   - Config file structure
   - Deployment assumptions

7. Stability Zones (30-40 lines)
   - Map real modules to ✅🔄⚠️🔮 zones
   - Clear guidance on what NOT to change

8. AI Coding Rules and Behavioral Contracts (40-60 lines)
   - Statement: "Does NOT define coding rules"
   - List all AI*.md files with purposes
   - Rule precedence hierarchy
   - Conflict resolution process
   - Key architectural decisions to preserve

9. Quick Start for AI Assistants (20-30 lines)
   - Pre-flight checklist before changes
   - Where to find specific information

––––––––––––––––––––
STYLE GUIDELINES:

- Use tables for comparisons (tech stack, stability zones)
- Use ASCII diagrams for flows (not prose descriptions)
- Use bullet points over paragraphs
- Link to docs with relative paths: `docs/implementation.md`
- Use emoji markers: ✅🔄⚠️🔮
- Keep sentences short and direct
- Target 250-300 lines total (enforce brevity)

––––––––––––––––––––
FINAL GOAL:

ARCHITECTURE.md should allow any AI coder to:
- Understand system structure in <5 minutes reading time
- Know WHERE to find coding rules (Section 8 lists AI*.md files)
- Avoid architectural violations (Section 7 stability zones)
- Behave conservatively and predictably (Section 8 precedence)
- Know what's stable vs experimental (Section 7 mappings)

––––––––––––––––––––
VALIDATION CHECKLIST:

After generation, verify:
- [ ] Total length: 250-300 lines
- [ ] Has all 9 sections with correct numbering
- [ ] Section 8 lists all AI*.md files
- [ ] Section 8 has rule precedence hierarchy
- [ ] Section 7 maps real components to stability zones
- [ ] No coding rules duplicated from AI*.md files
- [ ] Uses ASCII diagrams for data flows
- [ ] Links to other docs instead of duplicating
- [ ] Specific to this project (not generic)

I'll analyze the repository structure, existing documentation, and previous conversations to create a comprehensive ARCHITECTURE.md file. Let me start by exploring the codebase systematically.

---

👤 **USER:**
> [Request interrupted by user for tool use]

