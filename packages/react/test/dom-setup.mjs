// Real DOM for runtime tests (effects, clicks). Import first in DOM test files.
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:5175/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "getComputedStyle", "MutationObserver", "Event", "MouseEvent", "HTMLDialogElement", "location", "CustomEvent", "KeyboardEvent", "requestAnimationFrame", "cancelAnimationFrame"]) {
  if (!(key in globalThis) || key === "window" || key === "document") {
    Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
  }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
export { window };
