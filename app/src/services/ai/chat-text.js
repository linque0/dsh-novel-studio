import { marked } from "marked";
import DOMPurify from "dompurify";
export function renderChat(text) {
  return DOMPurify.sanitize(
    marked.parse(String(text || ""), { async: false, breaks: true }),
    {
      ALLOWED_TAGS: [
        "p",
        "br",
        "hr",
        "strong",
        "em",
        "s",
        "blockquote",
        "pre",
        "code",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "details",
        "summary",
        "span",
        "div",
        "a",
      ],
      ALLOWED_ATTR: ["href", "title", "open"],
      FORBID_TAGS: [
        "script",
        "style",
        "iframe",
        "svg",
        "img",
        "video",
        "audio",
      ],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    },
  );
}
export function plainChat(text) {
  const container = document.createElement("div");
  container.innerHTML = renderChat(text);
  container.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  container
    .querySelectorAll("p,pre,li,h1,h2,h3,h4,blockquote,tr,details")
    .forEach((el) => el.append("\n"));
  return (container.textContent || "").trim();
}
