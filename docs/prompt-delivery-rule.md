# Prompt Delivery Rule

When the user asks for a Codex prompt, the assistant must write the full executable prompt directly in the chat response first.

Do not only attach the prompt to a GitHub PR, issue, comment, docs file, or other external place. Those copies are allowed as an extra convenience, but the chat response must contain the complete prompt text so the user can immediately copy it.

Required behavior:

1. Put the full prompt in the chat.
2. If useful, also copy it to GitHub/PR/issues/docs.
3. Clearly say where it was additionally stored.
4. Never replace the chat prompt with only a summary or a link.
