# Agent-Auditor Bridge

The dashboard now has a client-only `Аудит` tab for starting an EzoHata Debugger / Agent-Auditor review of `ezohata-incoming-ledger` without manually copying raw JSON.

The older `/audit` page remains available as a direct fallback bridge.

## Main dashboard flow

1. Open the ledger site.
2. Click the `Аудит` tab.
3. Click `Запустить аудит`.
4. The dashboard fetches `/api/audit-snapshot`, formats the EzoHata Debugger prompt, copies it to the clipboard, and opens ChatGPT / the configured Debugger URL.
5. If the browser does not paste into the new ChatGPT window automatically, press `Cmd/Ctrl+V` in the new chat.

Use `Скопировать prompt` to copy the current prompt again. If browser clipboard access is blocked, the tab shows a readonly prompt textarea and a `Выделить всё` button for manual copying.

## Direct fallback page

1. Open `/audit` on the ledger site.
2. Click `Run Audit`.
3. The page fetches `/api/audit-snapshot`, formats the same prompt, copies it to the clipboard, and opens ChatGPT / the configured Debugger URL.
4. Paste the copied prompt into EzoHata Debugger.

## OpenClaw

OpenClaw is not required for the first-click audit launcher. It can be added later as a verifier/feedback-loop layer after the Debugger produces an audit result or a Codex repair plan.

## Security

- The bridge does not add tokens, OAuth data, or credentials to the request.
- The bridge calls exactly `/api/audit-snapshot`; it does not request `includeRows=1`.
- The snapshot and prompt are not logged by the page.
- Clipboard copying happens locally in the browser.
- The `Аудит` tab is UI-only and is not added to `sheet-config.json`, so dashboard/API/Google Sheets loaders do not treat it as a data sheet.
