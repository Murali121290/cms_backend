import 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pdfjs-viewer-element': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { src?: string },
        HTMLElement
      >
    }
  }
}

export {}
