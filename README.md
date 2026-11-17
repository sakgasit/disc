# DISC Personality Assessment (EN / ไทย) + Class Sessions

## Features
- 28-question DISC test with full English and Thai versions (toggle top-right; remembered per device)
- Personal result: scores, wheel, primary + blend style, strengths, watch-outs, sharing, print to PDF
- **Classroom mode**: a teacher creates a class and gets a 6-character code and link. Students enter a
  nickname and take the test. A live class board shows a class map (one dot per student), the style
  breakdown and the class average. Individual scores are never shown to other students.
- Teacher tools (only on the device that created the class): hide or show nicknames on the map, and
  remove entries.

## Project layout
```
public/                 static site (index.html, app.js, i18n.js, style.css, backend.js)
artifact/               single-file build for a Claude artifact (python3 artifact/build.py)
netlify/functions/      class.mjs: API for class sessions (Netlify Functions)
netlify.toml            tells Netlify what to publish
package.json            depends on @netlify/blobs (Netlify's built-in storage)
```

## Deploy (important: use Git or the CLI, not drag-and-drop)
Class sessions need a Netlify Function. **Drag-and-drop deploys don't include functions**, so use one of these:

**Option A: GitHub (recommended)**
1. Create a GitHub repo and upload the contents of this folder.
2. In Netlify: *Add new site → Import an existing project → GitHub* → pick the repo.
3. Leave the build command empty. Publish directory and functions are read from `netlify.toml`.
4. Deploy. Storage (Netlify Blobs) is set up automatically with no keys or database needed.

**Option B: Netlify CLI**
```
npm install -g netlify-cli
cd disc-app
npm install
netlify login
netlify deploy --prod
```

Local testing: `netlify dev`, then open http://localhost:8888

## Customize
- Text, questions and translations: `public/i18n.js` (questions repeat in D, I, S, C order)
- Colors: CSS variables at the top of `public/style.css`
- Max students per class: `MAX_MEMBERS` in `netlify/functions/class.mjs`

## Privacy notes
Only the class name, nicknames and the four scores are stored. Anyone with the class code can
view the board, so tell students to use nicknames rather than full names.
