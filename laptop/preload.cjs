/* The narrow bridge between her pages and the main process: each name one
   thing a page may ask, and the channels the main process may tell it on.
   CommonJS, because a sandboxed preload cannot be a module. */
const { contextBridge, ipcRenderer } = require('electron');

const TOLD = ['press', 'frame', 'done', 'trouble', 'briefing'];

contextBridge.exposeInMainWorld('doji', {
  on: (channel, fn) => {
    if (TOLD.includes(channel)) ipcRenderer.on(channel, (_, ...args) => fn(...args));
  },
  look: () => ipcRenderer.invoke('look'),
  ask: (voice) => ipcRenderer.send('ask', voice),
  hush: () => ipcRenderer.send('hush'),
  briefing: () => ipcRenderer.send('briefing'),
  solid: (yes) => ipcRenderer.send('solid', yes),
  drag: (dx, dy) => ipcRenderer.send('drag', dx, dy),
  key: (candidate) => ipcRenderer.invoke('key', candidate),
});
