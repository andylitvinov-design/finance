import revolutTransactionsHandler from "./revolut-transactions.js";
import {
  handleDebugAction as handleBaseDebugAction,
  isDebugAction as isBaseDebugAction,
} from "./debug-endpoints-base.js";

export { buildDebugUiState } from "./debug-endpoints-base.js";

const REVOLUT_TRANSACTIONS_ACTION = "revolutTransactions";

export function isDebugAction(action) {
  return action === REVOLUT_TRANSACTIONS_ACTION || isBaseDebugAction(action);
}

export async function handleDebugAction(request, response, action) {
  if (action === REVOLUT_TRANSACTIONS_ACTION) {
    return await revolutTransactionsHandler(request, response);
  }
  return await handleBaseDebugAction(request, response, action);
}
