import 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pdfjs-viewer-element': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          page?: string | number
          zoom?: string
          search?: string
          phrase?: string | boolean
          pagemode?: string
          'viewer-css-theme'?: string
          'iframe-title'?: string
        },
        HTMLElement
      >
    }
  }
}

export {}
