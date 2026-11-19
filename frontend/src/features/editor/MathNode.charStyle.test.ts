import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CharStyle } from "@/features/editor/CharStyle";
import { MathNode } from "@/features/editor/MathNode";
import { convertMathForSave } from "@/features/editor/convertMathForSave";

// Plain (non-React) node view so the test needs no React renderer.
const TestMathNode = MathNode.extend({ addNodeView: () => null as any });

function makeEditor(html: string) {
  return new Editor({
    extensions: [StarterKit, CharStyle, TestMathNode],
    content: html,
  });
}

// Shape emitted by app/processing/docx_to_xhtml_runs._omml_element_to_math_span
const BACKEND_MATH_HTML =
  '<p><span class="math-node" data-latex="x" ' +
  'data-mathml="&lt;math xmlns=&quot;http://www.w3.org/1998/Math/MathML&quot;&gt;&lt;mi&gt;x&lt;/mi&gt;&lt;/math&gt;" ' +
  'data-omml="QUJD" data-display="block">' +
  '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></span></p>';

describe("MathNode vs CharStyle", () => {
  it("parses a backend math span as MathNode, keeping data-omml and display", () => {
    const editor = makeEditor(BACKEND_MATH_HTML);
    const html = editor.getHTML();
    expect(html).toContain('data-omml="QUJD"');
    expect(html).toContain('data-display="block"');
    expect(html.match(/class="math-node"/g)?.length).toBe(1);
    editor.destroy();
  });

  it("keeps the equation through convertMathForSave", () => {
    const editor = makeEditor(BACKEND_MATH_HTML);
    const saved = convertMathForSave(editor.getHTML());
    expect(saved).toContain("<math");
    expect(saved).toContain('data-omml="QUJD"');
    editor.destroy();
  });
});

describe("convertMathForSave", () => {
  it("unwraps an empty math-node wrapper instead of deleting the nested equation", () => {
    const saved = convertMathForSave(
      '<p><span class="math-node"><span class="math-node" data-omml="WA=="></span></span></p>',
    );
    expect(saved).toContain("<math");
    expect(saved).toContain('data-omml="WA=="');
  });

  it("still removes a math span with no data and no content", () => {
    const saved = convertMathForSave('<p>a<span class="math-node"></span>b</p>');
    expect(saved).not.toContain("math");
    expect(saved).toContain("ab");
  });
});
