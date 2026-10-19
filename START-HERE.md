# START HERE — RealityGate

Turn an idea (plus any documents you have) into a real, tested, shipped product, built by
coding agents under a strict operating system. You talk; the agents plan, build, test, review,
and keep records. You approve the few decisions that are expensive to get wrong.

This kit is the generalised, upgraded version of the system used to build **Proxy**
(`AI-BUILD-OS.md` + `START-PROXY.md`). Proxy hit some problems in practice. Each fix is now part of the system
(see `BUILD-OS.md` → Appendix A).

---

## What's in the kit

```
realitygate/
├── START-HERE.md          ← this file (how to run it)
├── BUILD-OS.md            ← the constitution: phases, agents, gates, state, templates
├── .claude/agents/        ← planner, spec-critic, verifier, security-auditor, drift-auditor, researcher
└── docs/
    ├── IDEA.md            ← FILL THIS IN if you have no SRS (rough is fine; the agent will interrogate you)
    └── input/
        └── README.md      ← put your SRS here, plus ANY extra documents (research, PDFs, notes, screenshots, competitor links)
```

## Step 1 — Make the project folder

```bash
mkdir my-product && cd my-product && git init
npx github:usmanmanii/realitygate init --srs ../SRS.pdf   # kit, docs/, config, 6 subagents, your SRS
                                                          # (no SRS yet? leave out --srs)
npx github:usmanmanii/realitygate doctor    # checks everything is in place
```

(No Node? Copy the **contents** of this kit into the folder by hand instead, so `BUILD-OS.md`
sits at the repo root.)

**Using the Claude Code plugin?** Skip Steps 1–3 and say *"start <path to your SRS>"*. Without a
path, it asks where your SRS is and walks you through each step.

**Already have an app?** Run `npx github:usmanmanii/realitygate audit` first. It gives you a
Reality Score and a fix plan you can paste straight into your agent. Phase 0 then adopts your
existing code instead of scaffolding a new app.

## Step 2 — Give it your idea

1. **Have an SRS or requirements document?** It's the primary input: `init --srs` copied it to
   `docs/input/` (or copy it there yourself). Otherwise open `docs/IDEA.md` and fill in what
   you can. Skip what you don't know; write "unsure".
2. Put any other material in `docs/input/`: an SRS, a pitch deck, voice-note transcripts,
   WhatsApp-style notes, screenshots of apps you like, a spreadsheet of prices, anything.
   The agent reads it all and tells you where your documents contradict each other.

## Step 3 — Open Claude Code in the folder and send exactly this

```
Read BUILD-OS.md in full. Then read docs/IDEA.md and every file in docs/input/.
Execute PHASE 0 (Ingest + Environment Probe + Profile) only. Do not skip ahead.
If docs/input/ has an SRS, it is the primary requirements input.
Explain everything to me in plain language — I am vibe coding and may not know
the technical terms. Stop when Phase 0 exit criteria are met and print:
(1) the contradictions/gaps you found in my documents,
(2) the stack profile you recommend, why, and its monthly cost estimate, in one paragraph,
(3) the accounts/keys I must create myself,
(4) the first batch of Phase 1 questions.
```

## Step 4 — From then on, this is your whole vocabulary

Type these as plain words, without a slash: `/status` and `/resume` are Claude Code's own commands.

| You type | What happens |
|---|---|
| `continue` (or `resume`) | Agent resumes exactly where it stopped (reads `.agent/STATE.json`) |
| `status` | Where are we, requirements verified (X / Y), what's blocked, what needs *you*, running cost |
| `verify` | Runs every automated check; reports pass/fail; changes nothing |
| `next` | Closes the finished task, opens the next one, stops |
| `blocked` | Parks the current task with a reason, moves to the next unblocked one |
| `replan` | Rebuilds the task list from the spec without touching code |
| `checkpoint` | Every ~5 tasks: drift audit + full test run + "click through it yourself" list |
| `ship` (or `prepare release`) | Runs the release checklist with evidence for every line and writes `docs/RELEASE-READINESS.md`. Never deploys for you |
| `plan next release` | After R1 is release ready: plans R1.x/R2 from real feedback and usage |
| `explain` | Explains the last change in plain language: what, why, and how to see it working |
| `approve <id>` / `reject <id> <why>` | Answers a pending approval request |

**Session hygiene (most important habit):** one task per session. When a task finishes,
type `/clear`, then `continue`. Long chats cause drift. The state file makes a fresh session
cost you nothing.

## Step 5 — What only YOU can do (the agent will stop and ask)

1. **Read the spec** (`docs/SPEC.md`) and say "approved". Spend an hour on it. It's the
   highest-leverage hour of the whole project.
2. **Cut features.** The agent will force R1 under 12 features. Let it.
3. **Approve risky changes:** database shape, logins/permissions, money, deleting data,
   new libraries, going live. The agent explains each in plain words with a recommendation.
4. **Create accounts and paste keys** into `.env.local` yourself. The agent never sees secrets.
5. **Click through the app** at every checkpoint, on your phone. Tests passing doesn't prove the app is pleasant to use.
6. **Decide you're done.** "The agent says it's finished" doesn't count. The ship checklist does.

## If things go wrong

| Symptom | Type |
|---|---|
| Agent seems lost or is redoing work | `/clear` then `continue` |
| You changed your mind about a feature | Edit `docs/SPEC.md` (or ask the agent to), then `replan` |
| Same test failing again and again | `blocked`. Agent writes what it needs; read `.agent/BLOCKERS.md` |
| You don't understand what was built | `explain` |
| You want to see it running | ask: "run the app and show me <feature>" |
