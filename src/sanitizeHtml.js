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
    'hr',
    'a',
    'img',
    'code',
    'pre',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title'],
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
