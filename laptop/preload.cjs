/* The narrow bridge between her pages and the main process: each name one
   thing a page may ask, and the channels the main process may tell it on.
   Each page is handed only its own: the key window its key, and her face
   the rest — so nothing in the key window can send an answer or a word.
   CommonJS, because a sandboxed preload cannot be a module. */
const { contextBridge, ipcRenderer } = require('electron');

const TOLD = ['press', 'frame', 'done', 'trouble', 'briefing', 'briefing-now', 'journal', 'journal-now', 'say', 'cursor'];

contextBridge.exposeInMainWorld('doji', location.pathname.endsWith('/key.html') ? {
  key: (candidate) => ipcRenderer.invoke('key', candidate),
} : {
  on: (channel, fn) => {
    if (TOLD.includes(channel)) ipcRenderer.on(channel, (_, ...args) => fn(...args));
  },
  ready: () => ipcRenderer.invoke('ready'),
  look: () => ipcRenderer.invoke('look'),
  ask: (voice) => ipcRenderer.send('ask', voice),
  hush: () => ipcRenderer.send('hush'),
  briefing: () => ipcRenderer.send('briefing'),
  answer: (id, q, half) => ipcRenderer.invoke('answer', id, q, half),
  open: (pane) => ipcRenderer.send('open', pane),
  solid: (yes) => ipcRenderer.send('solid', yes),
  drag: (dx, dy) => ipcRenderer.send('drag', dx, dy),
  dropped: () => ipcRenderer.send('dropped'),
});
