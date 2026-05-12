import { createManualWorkbookHandler } from "../server/manual-workbook-route.js";

export default async function handler(request, response) {
  const routeName = String(request.query?.route || "manual-workbook").trim() || "manual-workbook";
  return await createManualWorkbookHandler(routeName)(request, response);
}
