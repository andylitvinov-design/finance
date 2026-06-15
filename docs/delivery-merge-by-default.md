# Delivery merge-by-default policy

`/delivery` should treat an opened pull request as an intermediate checkpoint, not as the normal finish line.

Default path:

1. implement the task;
2. run project checks;
3. create or update the pull request;
4. inspect PR health;
5. run the Spiral Validator-Critic Loop;
6. merge when the critic verdict is `READY_FOR_MERGE` or `READY_WITH_NOTES`;
7. continue to deployment and live verification when the project adapter requires it.

Review-only mode is allowed only when the user explicitly asks for review-only, PR-only, draft-only, or no-deploy work.

If merge cannot proceed, the final report must state the exact reason and the next action needed.
