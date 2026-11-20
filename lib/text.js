// Text hygiene for names that come from Meta. Only control characters are stripped; everything else (emoji, accents,
// zero-width joiners) is kept, and truncation counts user-perceived characters so a surrogate pair or an emoji
// sequence is never cut in half.
// U+FFFD shows up in Meta names where a character was mangled upstream. It goes away together with the space before it.
const REPLACEMENT = /\s*\uFFFD+/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const characters = text => (segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text));

export function truncate(text, max) {
  const value = String(text ?? '');
  const list = characters(value);
  return list.length <= max ? value : list.slice(0, max).join('');
}

// Lone surrogates (broken halves of an emoji) are made well-formed here, explicitly, instead of during a later UTF-8 encode, and
// then dropped along with every other U+FFFD.
export const cleanName = (value, max = 120) => truncate(String(value ?? '').toWellFormed().replace(REPLACEMENT, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim(), max);
