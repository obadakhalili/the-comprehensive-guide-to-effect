/* shared behaviour: syntax highlight + interactive steppers */

// ---- syntax highlighting (highlight.js, loaded via CDN in <head>) ----
window.addEventListener("DOMContentLoaded", () => {
  if (window.hljs) {
    document.querySelectorAll("pre code").forEach((el) => {
      if (!el.className) el.className = "language-typescript";
      window.hljs.highlightElement(el);
    });
  }
  document.querySelectorAll("[data-stepper]").forEach(initStepper);
  document.querySelectorAll(".toc[data-toc]").forEach(buildToc);

  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }
});

// ---- "on this page" table of contents, built from the h2s ----
function buildToc(toc) {
  const headings = [...document.querySelectorAll("main h2")];
  if (headings.length < 2) { toc.remove(); return; }
  const title = document.createElement("div");
  title.className = "toc-title";
  title.textContent = "On this page";
  const ol = document.createElement("ol");
  headings.forEach((h) => {
    if (!h.id) {
      h.id = h.textContent.toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = h.textContent;
    const li = document.createElement("li");
    li.appendChild(a);
    ol.appendChild(li);
  });
  toc.appendChild(title);
  toc.appendChild(ol);
}

// ---- interactive interpreter stepper ----
// expects a <script type="application/json"> inside the [data-stepper] element
function initStepper(root) {
  const dataEl = root.querySelector('script[type="application/json"]');
  if (!dataEl) return;
  const cfg = JSON.parse(dataEl.textContent);
  const steps = cfg.steps;
  let i = 0;

  root.innerHTML = `
    <div class="progress-track"><div class="progress-fill"></div></div>
    <div class="stepper-bar">
      <span class="title">${cfg.title || "interpreter trace"}</span>
      <button class="stepper-btn prev">‹ back</button>
      <button class="stepper-btn next">step ›</button>
      <span class="count"></span>
    </div>
    <div class="stepper-body">
      <p class="stepper-desc"></p>
      <div class="machine">
        <div class="reg current"><span class="lab">current node</span><span class="val"></span></div>
        <div class="reg register"><span class="lab">register</span><span class="val"></span></div>
        <div class="reg stackreg" style="grid-column:1/-1"><span class="lab">continuation stack (top = next to pop)</span><div class="chips"></div></div>
      </div>
    </div>`;

  const fill = root.querySelector(".progress-fill");
  const desc = root.querySelector(".stepper-desc");
  const count = root.querySelector(".count");
  const cur = root.querySelector(".current .val");
  const regBox = root.querySelector(".register");
  const reg = root.querySelector(".register .val");
  const chips = root.querySelector(".chips");
  const prev = root.querySelector(".prev");
  const next = root.querySelector(".next");

  function render() {
    const s = steps[i];
    desc.innerHTML = s.desc;
    count.textContent = `${i + 1} / ${steps.length}`;
    cur.textContent = s.current ?? "—";
    if (s.failing) { regBox.classList.add("fail"); reg.textContent = s.register; }
    else { regBox.classList.remove("fail"); reg.textContent = s.register; }
    chips.innerHTML = (s.stack && s.stack.length)
      ? s.stack.map((c, idx) => {
          const top = idx === s.stack.length - 1 ? " top" : "";
          const dim = c.startsWith("~") ? " dim" : "";
          return `<span class="chip${top}${dim}">${c.replace(/^~/, "")}</span>`;
        }).join("")
      : `<span style="color:#8a7f6f;font-size:12.5px">empty</span>`;
    fill.style.width = `${((i + 1) / steps.length) * 100}%`;
    prev.disabled = i === 0;
    next.disabled = i === steps.length - 1;
  }
  prev.onclick = () => { if (i > 0) { i--; render(); } };
  next.onclick = () => { if (i < steps.length - 1) { i++; render(); } };
  render();
}
