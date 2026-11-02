# River

A place to write and let go. You type, and nothing is ever stored. The text box
fills the screen, so the page is as big as your device allows: when the words
outgrow it, the oldest words wash away, one at a time.

## Run it

It's a static site with no build step and no dependencies:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Use a local server rather than opening
`index.html` from disk, because the security policy may block the page's own files.

## Privacy

- Words stay in the page's memory only, and are never written to storage or cookies.
- A Content Security Policy in `index.html` blocks all network requests from the page.
- Reloading or closing the page forgets everything.
- Autocomplete and spellcheck are off, so the browser doesn't remember the text or
  send it to a spelling service.

Three things are outside the page's control: what a host serves, what browser
extensions or the OS can see, and third-party keyboards.

## Files

- `index.html`: the page and its security policy
- `style.css`: the flexbox layout, for phone and PC
- `river.js`: writing, the page limit and the vanishing effect
- `water.js`: the moving glacial water background (WebGL)
