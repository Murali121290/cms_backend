import katex from "katex";

// Convert client-only math spans to <math> elements on save. Priority:
//   1. data-omml (raw OMML from the source DOCX, unchanged) — the backend
//      will inject it byte-for-byte. Lossless round-trip.
//   2. data-mathml (MathML captured either from source or from Mathlive
//      after an edit) — backend runs it through mathml2omml.
//   3. data-latex (equation authored via the ∑ button and edited only in
//      LaTeX) — backend converts LaTeX → MathML → OMML.
// Comment spans (`span[data-comment-id]`) are preserved so the backend
// can pair each highlighted range with its metadata when generating DOCX.
export function convertMathForSave(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const mathSpans = doc.querySelectorAll("span.math-node, span[data-latex], span[data-mathml], span[data-omml]");
  mathSpans.forEach(span => {
    // A span may already have been removed or replaced via an ancestor.
    if (!span.isConnected) return;

    const latex = span.getAttribute("data-latex") || "";
    const mathml = span.getAttribute("data-mathml") || "";
    const omml = span.getAttribute("data-omml") || "";
    const display = span.getAttribute("data-display") || "inline";

    try {
      let mathEl: Element | null = null;
      if (mathml) {
        const temp = document.createElement("div");
        temp.innerHTML = mathml;
        mathEl = temp.querySelector("math");
      }
      if (!mathEl && latex) {
        const temp = document.createElement("div");
        temp.innerHTML = katex.renderToString(latex, { output: "mathml", throwOnError: false });
        mathEl = temp.querySelector("math");
      }
      if (!mathEl) {
        if (!omml && !mathml && !latex) {
          // No math data on this span. If it wraps other content (e.g. a
          // nested real math-node span), unwrap it rather than deleting —
          // removing it would silently drop the equation inside. The
          // static NodeList still visits the nested span afterwards.
          const parent = span.parentNode;
          if (parent) {
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
          }
          return;
        }
        // Neither MathML nor KaTeX gave us a parseable <math>. Build a
        // minimal one so the equation still round-trips: the backend has
        // a data-omml / data-mathml / data-latex priority chain and can
        // rebuild the OMML from any of them.
        const doc2 = span.ownerDocument || document;
        mathEl = doc2.createElementNS("http://www.w3.org/1998/Math/MathML", "math");
      }
      if (omml) mathEl.setAttribute("data-omml", omml);
      if (mathml) mathEl.setAttribute("data-mathml", mathml);
      if (latex) mathEl.setAttribute("data-latex", latex);
      if (display) mathEl.setAttribute("data-display", display);
      // Carry the wrapper formatting so the backend can inject it into
      // every <m:r>'s <m:rPr>/<w:rPr> on the OMML side.
      const carry = [
        "data-wrapper-bold",
        "data-wrapper-italic",
        "data-wrapper-color",
        "data-wrapper-bg",
        "data-wrapper-size",
        "data-wrapper-font",
      ];
      for (const attr of carry) {
        const v = span.getAttribute(attr);
        if (v) mathEl.setAttribute(attr, v);
      }
      span.parentNode?.replaceChild(mathEl, span);
    } catch (err) {
      console.error("Failed to serialize math node on save:", err);
    }
  });

  return doc.body.innerHTML;
}
