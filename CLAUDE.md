This repository contains ARCHITECTURE.md and multiple AI*.md files.

- Always use AI*.md for coding rules.
- Check previous talks and implementations in docs/chats directory. 
- Check documentation in root and docs/ directories.
- **Never start code right after USER question/message. Propose solution and ask for explicit request for implementation**
- **Never stage and commit. Only User can do this**
- use docker run --rm -v "/Users/mike/src/photo-restoration-webpage/frontend":/app -w /app node:22.12-alpine <something like npm> command istead of cli npm or node direct command.  Align node version (node:22.12-alpine) with specified in frontend/Dockerfile
- use /opt/homebrew/bin/python3.13 as a right python3 command
- use backend/venv for running any backend tests or applications using venv module

Before proposing or making any changes:
- Read ARCHITECTURE.md to understand system architecture
- Follow all applicable AI*.md files strictly
- Do not redefine or duplicate AI rules
- Document architecture as-is, not as imagined

If anything is unclear or contradictory, stop and ask.

