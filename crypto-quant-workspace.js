const composer = document.querySelector(".composer");
const textarea = document.querySelector("textarea");
const chatEmpty = document.querySelector(".chat-empty");

composer.addEventListener("submit", (event) => {
  event.preventDefault();

  const message = textarea.value.trim();
  if (!message) return;

  const bubble = document.createElement("div");
  bubble.className = "user-message";
  bubble.textContent = message;
  chatEmpty.classList.add("has-thread");
  chatEmpty.appendChild(bubble);
  textarea.value = "";
});
