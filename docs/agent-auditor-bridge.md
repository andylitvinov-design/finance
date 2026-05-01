# Agent-Auditor Bridge

The `/audit` page is a small browser bridge for starting an Agent-Auditor review of `ezohata-incoming-ledger` without manually copying raw JSON.

## How to use

1. Open `/audit` on the ledger site.
2. Click `Run Audit`.
3. The page fetches `/api/audit-snapshot`, formats the Agent-Auditor prompt, copies it to the clipboard, and opens [ChatGPT](https://chat.openai.com/).
4. Paste the copied prompt into Agent-Auditor.

Use `Copy Prompt` to copy the current prompt again. If browser clipboard access is blocked, the page shows a readonly prompt textarea and a `Select all` button for manual copying.

## Security

- The bridge does not add tokens, OAuth data, or credentials to the request.
- The bridge calls exactly `/api/audit-snapshot`; it does not request `includeRows=1`.
- The snapshot and prompt are not logged by the page.
- Clipboard copying happens locally in the browser.
