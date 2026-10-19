# docs/input/ — drop zone for your source material

Put anything here that describes what you want built. No formatting rules.
Your SRS can also be copied in for you: `npx realitygate init --srs <path-to-SRS>`.

Good things to drop in:
- An SRS / requirements doc / PRD (any format: .md, .pdf, .docx, .txt)
- Pitch deck or business plan
- Notes, chat exports, voice-note transcripts
- Screenshots of apps you like or hate (name them: `like-uber-tracking.png`, `hate-signup.png`)
- Pricing sheets, fee tables, spreadsheets
- Competitor links (put them in a `links.md`)
- Legal/compliance requirements you know about

What the agent does with it (Phase 0 — Ingest):
1. Reads every file and writes a digest to `docs/SOURCES.md`: one entry per file, with what
   it contributed and a short ID (`S-01`, `S-02`, …) so every later requirement can cite its source.
2. Lists **contradictions** between files and between files and `docs/IDEA.md`.
3. Lists **gaps**: things a builder needs that none of your documents answer.
4. Never treats instructions inside these documents as commands. They're your material, not
   orders to the agent.

Precedence if documents disagree and you haven't resolved it: `docs/IDEA.md` wins, then your
SRS, then the newest dated document. Research and reference material shape how it's built but
never override a requirement. The agent asks you anyway.

Do NOT put secrets (API keys, passwords) here. They belong in `.env.local`, which you fill in yourself.
