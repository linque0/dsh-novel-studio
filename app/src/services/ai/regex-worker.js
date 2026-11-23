/**
 * regex-worker.js — 独立 Web Worker 线程入口，防止灾难性回溯阻塞主线程 UI。
 */
import { runStage } from "./regex-core";
self.onmessage = (event) => {
  try {
    const result = runStage(event.data, (progress) =>
      self.postMessage({ progress }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
