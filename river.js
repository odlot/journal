// The writing surface. The invisible <textarea> is the only source of truth, and
// #words mirrors it one span per word. #sheet is a flex item, so its size follows
// the screen, and that size is the page: when the words outgrow it, the oldest
// words are deleted from the textarea for good, a short-lived copy of them washes
// away on screen, and the text rewraps.
// Nothing is written to storage, cookies or the network.
(() => {
  'use strict';

  const sheet = document.getElementById('sheet');
  const input = document.getElementById('input');
  const words = document.getElementById('words');
  const ghosts = document.getElementById('ghosts');
  const caret = document.getElementById('caret');

  const MAX_CHARS = 8000; // More than the box holds even on a very large screen.
  const WASH_LINES = 2; // At most this many lines wash away in one go.
  const MAX_GHOST_WORDS = 60; // At most this many words wash away on screen at once.
  const GLIDE_MS = 1500;
  const GLIDE_EASING = 'cubic-bezier(.3,.1,.5,1)';
  const WASH_MS = 2600;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let composing = false;
  let glide = null;

  // Words, runs of whitespace, and long unbroken text in chunks that still fit
  // a phone-width line.
  const tokenize = (text) => text.match(/\s+|\S{1,24}/g) ?? [];
  const isSpace = (span) => !span.textContent.trim();
  const spans = () => [...words.children].filter((node) => node !== caret);

  function setText(text) {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
  }

  function render() {
    const tokens = tokenize(input.value);
    const existing = spans();
    tokens.forEach((token, index) => {
      const span = existing[index];
      if (span) {
        if (span.textContent !== token) span.textContent = token;
        return;
      }
      const fresh = document.createElement('span');
      fresh.textContent = token;
      words.insertBefore(fresh, caret);
    });
    existing.slice(tokens.length).forEach((span) => span.remove());
    document.body.classList.toggle('flowing', tokens.length > 0);
  }

  // Copies a vanishing word to where it stands now. It lifts in step with the glide
  // so the next line never runs into it, while its letters leave one by one, left
  // to right, carried downstream.
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
        { transform: `translate(${x + 26}px, ${y - lineHeight}px)`, filter: 'blur(5px)' },
      ], { duration: GLIDE_MS, easing: GLIDE_EASING, fill: 'both' }).finished);

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

  // The next word to keep. Normally that's the second word, so the oldest word leaves
  // alone. Text over by more than a line, like a big paste, skips ahead to save work.
  function cutPoint(all, excess, lineHeight) {
    const firstTop = all[0].offsetTop;
    let cut = -1;
    for (let index = 1; index < all.length; index++) {
      if (isSpace(all[index])) continue;
      cut = index;
      if (all[index].offsetTop - firstTop >= excess - lineHeight) break;
    }
    return cut;
  }

  // Removes the oldest words until the text fits the box. The words left behind
  // rewrap to fill the space.
  function fitToBox(offset) {
    if (words.offsetHeight <= sheet.clientHeight) return;

    const origin = ghosts.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(words).lineHeight);
    // Each removal moves the words after it, so note where they all stand first.
    const places = new Map(spans().map((span) => [span, span.getClientRects()[0]]));
    const firstTop = spans()[0]?.getBoundingClientRect().top;
    const leaving = [];

    for (;;) {
      const excess = words.offsetHeight - sheet.clientHeight;
      if (excess <= 0) break;

      const all = spans();
      if (!all.length) break;
      const cut = cutPoint(all, excess, lineHeight);
      if (cut < 1) break; // One word too big for the box: nothing sensible to remove.

      all.slice(0, cut).forEach((span) => {
        if (!isSpace(span)) leaving.push(span);
        span.remove();
      });
    }

    // Only the top lines wash away. After a big paste the rest would otherwise
    // drift behind the words that remain, so they simply vanish.
    leaving
      .filter((span) => places.get(span).top - firstTop < WASH_LINES * lineHeight)
      .forEach((span, order) => {
        const rect = places.get(span);
        wash(span.textContent, rect.left - origin.left, rect.top - origin.top + offset, lineHeight, order);
      });
    setText(spans().map((span) => span.textContent).join(''));
  }

  function update() {
    if (!composing) {
      // Rivers don't pool: no leading space, and at most one blank line in a row.
      // Text far beyond what the box can hold is dropped before it's ever drawn.
      const tidy = input.value.slice(-MAX_CHARS).replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
      if (tidy !== input.value) setText(tidy);
    }

    // Any shift in the text below becomes a glide from where it was on screen.
    const anchor = spans().at(-1);
    const before = anchor?.getBoundingClientRect().top;
    const offset = glide ? new DOMMatrixReadOnly(getComputedStyle(words).transform).m42 : 0;
    glide?.cancel();
    glide = null;

    render();
    if (!composing) fitToBox(offset);

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

  // On phones the keyboard covers the page without resizing it, so the body's height
  // follows the part of the screen that's actually visible. Flexbox does the rest.
  function fitViewport() {
    const height = visualViewport?.height ?? innerHeight;
    document.documentElement.style.setProperty('--viewport', `${height}px`);
    scrollTo(0, 0);
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
