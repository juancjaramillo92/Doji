/* A key, tried at its door before it is kept; the main process closes this
   window when it is, or asks in it for the other key. Which key is asked is
   in the window's address, and the page says whose. */
const WHOSE = {
  eugenia: ['Eugenia key', 'EUGENIA_LAPTOP_SECRET'],
  gladys: ['Gladys key', 'GLADYS_LAPTOP_SECRET'],
};
const SAID = {
  wrong: "The door doesn't know that key. Check it was copied whole.",
  offline: "The door couldn't be reached. Is the laptop online?",
};

const [whose, secret] = WHOSE[new URLSearchParams(location.search).get('who')];
document.getElementById('whose').textContent = whose;
document.getElementById('secret').textContent = secret;

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const said = document.getElementById('said'), button = e.target.querySelector('button');
  said.textContent = 'Trying…';
  button.disabled = true;
  said.textContent = SAID[await window.doji.key(document.getElementById('key').value)] ?? '';
  button.disabled = false;
});
