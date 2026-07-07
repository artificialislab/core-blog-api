import sanitizeHtmlLibrary from 'sanitize-html';

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    's',
    'u',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'hr',
    'a',
    'img',
    'code',
    'pre',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'title', 'class'],
    img: ['src', 'alt', 'title', 'class', 'width', 'height', 'loading', 'decoding'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtmlLibrary.simpleTransform('a', {
      rel: 'noopener noreferrer',
      target: '_blank',
    }),
  },
};

export function sanitizeHtml(input) {
  return sanitizeHtmlLibrary(String(input || ''), SANITIZE_OPTIONS);
}

// Texto puro: remove QUALQUER tag/atributo. Para campos que nunca devem
// conter HTML (excerpt, seo.title, seo.description).
const PLAIN_TEXT_OPTIONS = {
  allowedTags: [],
  allowedAttributes: {},
};

export function sanitizePlainText(input) {
  return sanitizeHtmlLibrary(String(input || ''), PLAIN_TEXT_OPTIONS);
}
