/* Her key, tried at her door before it is kept; the main process closes this
   window when it is. */
const SAID = {
  wrong: 'Her door does not know that key.',
  offline: 'Her door could not be reached. Is the laptop online?',
};

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const said = document.getElementById('said');
  said.textContent = 'Trying…';
  said.textContent = SAID[await window.doji.key(document.getElementById('key').value)] ?? '';
});
