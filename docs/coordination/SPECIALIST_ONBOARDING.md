# Folio Specialist — Activation and New-Chat Recovery

**Repository:** budapesservices-dotcom/folio-studio
**Canonical identity:** [AGENT_IDENTITY.md](AGENT_IDENTITY.md)
**Recovery procedure:** [RECOVERY_PROTOCOL.md](RECOVERY_PROTOCOL.md)

## 1. Initial activation — once per existing specialist conversation

Send the matching first line to the existing GPT chat, replacing the role number:

**AKTIFKAN GPT1 DARI REPOSITORY FOLIO**

Use GPT2, GPT3, or GPT4 in the corresponding specialist chat.

The specialist must then read these files from the repository default branch:

1. [AGENT_IDENTITY.md](AGENT_IDENTITY.md)
2. [AGENTS.md](../../AGENTS.md)
3. [PROTOCOL.md](PROTOCOL.md)
4. [RECOVERY_PROTOCOL.md](RECOVERY_PROTOCOL.md)
5. [TASK_BOARD.md](TASK_BOARD.md)
6. [AGENT_STATE.md](AGENT_STATE.md)

It must verify that the requested GPT number matches its canonical role. If all required files are accessible, it acknowledges with:

**AKTIF — GPT1 — Folio Task Inbox and recovery protocol loaded.**

Replace GPT1 with the correct role. If the repository cannot be accessed, it must report BLOCKED instead of claiming activation.

## 2. New conversation after quota / chat limit

Do not paste the original activation instructions again. Open a new chat for the same specialist and send only:

- **PULIHKAN GPT1**
- **PULIHKAN GPT2**
- **PULIHKAN GPT3**
- **PULIHKAN GPT4**

The new conversation must follow [RECOVERY_PROTOCOL.md](RECOVERY_PROTOCOL.md), read the current repository state, inspect the active task packet and its latest GitHub evidence, then report PULIH or BLOCKED.

A new conversation does not automatically inherit the old transcript. Repository records can restore the role, assignment, and last saved checkpoint, but cannot restore uncommitted work or chat-only details.

## 3. Daily task start and completion

When GPT0 announces a task is ready and its status is DISPATCHED, the CEO opens the matching specialist conversation and sends only:

**MULAI**

or

**LAKSANAKAN**

The specialist reads its own task packet from GitHub and replies briefly:

- **DITERIMA — TASK-ID — mulai dikerjakan.**
- **SELESAI — TASK-ID — PR/ISSUE LINK — menunggu GPT0.**
- **BLOCKED — TASK-ID — ONE-LINE BLOCKER.**

For a durable handoff, specialists must save meaningful progress and findings to their assigned GitHub PR/Issue. Never leave the only copy of important progress in chat.

## 4. Important limitations

- Separate ChatGPT conversations do not automatically communicate with each other.
- This workflow does not restore an old chat transcript or hidden model reasoning.
- Recovery works only to the extent that the new conversation can access the repository and the specialist's actual GitHub evidence.
- If a checkpoint was never committed or recorded, it is not recoverable. The specialist must say so honestly.
- The CEO remains the final authority for scope changes, merges, and releases.
