/* Her key, tried at her door before it is kept; the main process closes this
   window when it is. */
const SAID = {
  wrong: "Her door doesn't know that key. Check it was copied whole.",
  offline: "Her door couldn't be reached. Is the laptop online?",
};

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const said = document.getElementById('said'), button = e.target.querySelector('button');
  said.textContent = 'Trying…';
  button.disabled = true;
  said.textContent = SAID[await window.doji.key(document.getElementById('key').value)] ?? '';
  button.disabled = false;
});
