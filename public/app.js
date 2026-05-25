(function () {
  const loginSection = document.getElementById("login-section");
  const helloSection = document.getElementById("hello-section");
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("error-message");
  const submitBtn = document.getElementById("submit-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const helloUsernameEl = document.getElementById("hello-username");
  const helloNameLine = document.getElementById("hello-name-line");
  const helloDisplayNameEl = document.getElementById("hello-display-name");

  function setError(text) {
    if (!text) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = text;
  }

  function showHello(username, displayName) {
    helloUsernameEl.textContent = username;
    helloNameLine.hidden = false;
    helloDisplayNameEl.textContent = displayName
      ? displayName
      : "（AD から氏名を取得できませんでした）";
    helloDisplayNameEl.classList.toggle("hello-display-name--muted", !displayName);
    loginSection.hidden = true;
    helloSection.hidden = false;
  }

  function showLogin() {
    helloSection.hidden = true;
    loginSection.hidden = false;
    setError("");
    form.reset();
    document.getElementById("username").focus();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    submitBtn.disabled = true;
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        showHello(data.username || username, data.displayName || "");
        return;
      }

      setError(data.message || "ログインに失敗しました。");
    } catch {
      setError("サーバーに接続できませんでした。");
    } finally {
      submitBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", () => {
    showLogin();
  });
})();
