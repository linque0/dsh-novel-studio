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
