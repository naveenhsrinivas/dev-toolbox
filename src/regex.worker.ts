// Runs regexes off the main thread, so a pattern with catastrophic backtracking
// can be stopped (by terminating this worker) instead of freezing the page.
import { type RegexRequest, runRegex } from "./lib/regex";

self.onmessage = (e: MessageEvent<{ id: number; request: RegexRequest }>) => {
  self.postMessage({ id: e.data.id, response: runRegex(e.data.request) });
};
