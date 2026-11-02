// The writing surface. The invisible <textarea> holds the page: never more than
// 300 words. #words mirrors it one span per word. When word 301 arrives, the oldest
// word is deleted from the textarea for good, a short-lived copy of it washes away
// on screen, and an empty gap holds its place so the other lines don't rewrap. Once
// a whole line is empty it's removed and the text glides up.
// Nothing is written to storage, cookies or the network.
(() => {
  'use strict';

  const input = document.getElementById('input');
  const words = document.getElementById('words');
  const ghosts = document.getElementById('ghosts');
  const caret = document.getElementById('caret');

  const PAGE_WORDS = 300;
  const MAX_GHOST_WORDS = 120; // At most this many words wash away on screen at once.
  const GLIDE_MS = 1100;
  const GLIDE_EASING = 'cubic-bezier(.3,.1,.5,1)';
  const WASH_MS = 2600;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let composing = false;
  let glide = null;

  // Words, runs of whitespace, and long unbroken text in chunks that still fit
  // a phone-width line.
  const tokenize = (text) => text.match(/\s+|\S{1,24}/g) ?? [];
  const isSpace = (span) => !span.textContent.trim();
  const isGone = (span) => span.classList.contains('gone');
  const allSpans = () => [...words.children].filter((node) => node !== caret);
  const liveSpans = () => allSpans().filter((span) => !isGone(span));

  function setText(text) {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
  }

  function render() {
    const tokens = tokenize(input.value);
    const existing = liveSpans();
    tokens.forEach((token, index) => {
      const span = existing[index];
      if (span) {
        if (span.textContent !== token) span.textContent = token;
        return;
      }
      const fresh = document.createElement('span');
      fresh.textContent = token;
      if (token.trim()) fresh.className = 'fresh';
      words.insertBefore(fresh, caret);
    });
    existing.slice(tokens.length).forEach((span) => span.remove());
    if (!tokens.length) allSpans().forEach((span) => span.remove()); // No gaps left to hold.
    document.body.classList.toggle('flowing', tokens.length > 0);
  }

  // Copies a vanishing word to where it stands now. Letters leave one by one, left
  // to right, carried downstream while the word blurs.
  function wash(text, x, y, lineHeight, order) {
    if (ghosts.children.length >= MAX_GHOST_WORDS) return;
    const delay = order * 70;

    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.transform = `translate(${x}px, ${y}px)`;
    const letters = [...text].map((letter) => {
      const part = document.createElement('span');
      part.textContent = letter;
      ghost.append(part);
      return part;
    });
    ghosts.append(ghost);

    const finished = [];
    if (reducedMotion.matches) {
      finished.push(ghost.animate({ opacity: [1, 0] },
        { duration: 1200, delay, easing: 'ease-out', fill: 'both' }).finished);
    } else {
      finished.push(ghost.animate([
        { transform: `translate(${x}px, ${y}px)`, filter: 'blur(0)' },
        { transform: `translate(${x + 26}px, ${y - lineHeight * 0.5}px)`, filter: 'blur(5px)' },
      ], { duration: WASH_MS, delay, easing: GLIDE_EASING, fill: 'both' }).finished);

      letters.forEach((letter, index) => {
        finished.push(letter.animate([
          { transform: 'translate(0, 0)', opacity: 1 },
          { transform: `translate(${10 + index}px, ${(index % 3 - 1) * 5}px)`, opacity: 0 },
        ], {
          duration: WASH_MS * 0.7,
          delay: delay + index * 45,
          easing: 'ease-out',
          fill: 'both',
        }).finished);
      });
    }
    Promise.allSettled(finished).then(() => ghost.remove());
  }

  // Text far past the page is dropped before it's ever drawn, so a huge paste can't
  // stall the page. Only the words that can still wash away on screen are kept.
  function dropFarOverflow(text) {
    const tokens = tokenize(text);
    let kept = 0;
    let start = tokens.length;
    while (start > 0 && kept < PAGE_WORDS + MAX_GHOST_WORDS) {
      start--;
      if (tokens[start].trim()) kept++;
    }
    return start > 0 ? tokens.slice(start).join('') : text;
  }

  // Removes the oldest words until the page holds 300 again. All measuring happens
  // before anything changes, so the browser only has to lay the page out once.
  function trimToPage(offset) {
    const live = liveSpans();
    const excess = live.filter((span) => !isSpace(span)).length - PAGE_WORDS;
    if (excess <= 0) return;

    const leaving = [];
    let index = 0;
    for (let found = 0; found < excess; index++) {
      if (!isSpace(live[index])) found++;
      leaving.push(live[index]);
    }
    // The whitespace after a vanished word goes too, but keeps its place.
    if (isSpace(live[index])) leaving.push(live[index]);

    const origin = ghosts.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(words).lineHeight);
    const leavingWords = leaving.filter((span) => !isSpace(span)).map((span) => {
      const rect = span.getBoundingClientRect();
      return { span, text: span.textContent, rect };
    });

    leaving.forEach((span) => { span.className = 'gone'; });
    leavingWords.forEach(({ span, text, rect }, order) => {
      wash(text, rect.left - origin.left, rect.top - origin.top + offset, lineHeight, order);
      span.textContent = '';
      span.style.width = `${rect.width}px`; // Holds the word's width, but none of its text.
    });
    setText(liveSpans().map((span) => span.textContent).join(''));
  }

  // Lines holding only gaps are finished. Removing them leaves the rest unchanged.
  function dropEmptyLines() {
    const first = liveSpans()[0];
    if (!first) return;
    allSpans().some((span) => {
      if (span === first) return true;
      if (span.offsetTop < first.offsetTop) span.remove();
      return false;
    });
  }

  // When 300 words don't fit the screen, older lines sit above the top edge and
  // the newest words stay in view.
  function followCaret() {
    const hidden = Math.max(0, words.offsetHeight - ghosts.clientHeight);
    words.style.marginTop = `${-hidden}px`;
  }

  function update() {
    if (!composing) {
      // Rivers don't pool: no leading space, and at most one blank line in a row.
      const tidy = dropFarOverflow(input.value).replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
      if (tidy !== input.value) setText(tidy);
    }

    // Any shift in the text below becomes a glide from where it was on screen.
    const anchor = allSpans().at(-1);
    const before = anchor?.getBoundingClientRect().top;
    const offset = glide ? new DOMMatrixReadOnly(getComputedStyle(words).transform).m42 : 0;
    glide?.cancel();
    glide = null;

    render();
    if (!composing) trimToPage(offset);
    dropEmptyLines();
    followCaret();

    if (anchor?.isConnected && !reducedMotion.matches) {
      const distance = before - anchor.getBoundingClientRect().top;
      if (Math.abs(distance) > 0.5) {
        const animation = words.animate(
          { transform: [`translateY(${distance}px)`, 'translateY(0)'] },
          { duration: GLIDE_MS, easing: GLIDE_EASING },
        );
        glide = animation;
        animation.finished.then(() => { if (glide === animation) glide = null; }, () => {});
      }
    }
  }

  function forget() {
    setText('');
    render();
    ghosts.replaceChildren();
  }

  // The caret always stays at the end: this river only flows forward.
  function keepCaretAtEnd() {
    if (composing || document.activeElement !== input) return;
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) {
      input.setSelectionRange(end, end);
    }
  }

  // Picks a text size so 300 average words fit the screen. Where that would be too
  // small to read comfortably, as on phones, it keeps a comfortable size instead.
  function fitText() {
    const AREA_PER_CHAR = 0.77; // Average character width × line height, in font-size².
    const PAGE_CHARS = 1900;
    const fitted = Math.sqrt(words.clientWidth * ghosts.clientHeight / (AREA_PER_CHAR * PAGE_CHARS));
    const size = fitted < 15 ? 18 : Math.min(fitted, 26);
    document.documentElement.style.setProperty('--size', `${size}px`);
  }

  // On phones the keyboard covers the page without resizing it, so the page follows
  // the part of the screen that's actually visible. Gaps are measured for the old
  // layout, so they go, and the remaining words rewrap.
  function fitViewport() {
    const height = visualViewport?.height ?? innerHeight;
    const width = innerWidth;
    document.documentElement.style.setProperty('--viewport', `${height}px`);
    scrollTo(0, 0);
    if (width !== fitViewport.width) {
      fitViewport.width = width;
      fitText();
    }
    allSpans().filter(isGone).forEach((span) => span.remove());
    update();
  }

  input.addEventListener('beforeinput', keepCaretAtEnd);
  input.addEventListener('input', update);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  document.addEventListener('selectionchange', keepCaretAtEnd);
  visualViewport?.addEventListener('resize', fitViewport);
  addEventListener('resize', fitViewport);

  // Words shouldn't survive a page close or come back through the Back button,
  // and browsers may otherwise restore textarea contents on reload.
  addEventListener('pagehide', forget);
  addEventListener('pageshow', forget);

  fitViewport();
  input.focus({ preventScroll: true });
})();
