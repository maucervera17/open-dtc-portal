// Injected only by the local demo server (never part of public/). Shows that the data on screen is fictional.
(function () {
  if (document.querySelector(".dtc-demo-banner")) return;
  var bar = document.createElement("div");
  bar.className = "dtc-demo-banner";
  bar.setAttribute("role", "note");
  var label = document.createElement("strong");
  label.textContent = "Demo mode";
  var text = document.createElement("span");
  text.textContent = "— fictional data";
  var link = document.createElement("a");
  link.href = "/demo/login";
  link.textContent = "restart session";
  link.title = "Sign in again as demo@example.com";
  bar.append(label, text, link);
  document.body.appendChild(bar);
})();
