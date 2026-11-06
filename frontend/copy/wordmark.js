// Footer wordmark: a giant "PayKit" that rides up with the scroll and locks in place.
// As the footer scrolls into view, the word moves up at a slower speed than the page
// (parallax), each letter rises out of its own mask a little after the one before it, and the
// letters tighten from wide spacing into the final word. Everything settles exactly when the
// footer is fully in view, then holds still. The cursor tilts the letter under it. Reduced
// motion shows the finished word without movement.
// Injected verbatim into the footer bundle, so plain browser JavaScript only.
export default (root) => {
  const letters = [...root.querySelectorAll("[data-pk-letter]")];
  const word = root.querySelector("[data-pk-word]");
  const footer = root.closest("footer") || root;
  if (!word || !letters.length) return () => {};

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  let raf = 0;
  let shown = -1;

  const update = () => {
    raf = 0;
    const r = footer.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    // 0 when the footer's top touches the bottom of the screen, 1 when the footer fills it.
    const p = still ? 1 : clamp((vh - r.top) / Math.max(1, Math.min(r.height, vh)));
    if (Math.abs(p - shown) < 0.0005) return;
    shown = p;
    const e = ease(p);
    word.style.transform = `translate3d(0, ${((1 - e) * -22).toFixed(2)}vh, 0)`;
    const n = letters.length;
    letters.forEach((el, i) => {
      const start = (i / n) * 0.45;
      const t = ease(clamp((p - start) / 0.55));
      el.style.transform = `translate3d(0, ${((1 - t) * 105).toFixed(2)}%, 0) rotate(${((1 - t) * (i % 2 ? 6 : -6)).toFixed(2)}deg)`;
    });
    root.toggleAttribute("data-settled", p >= 0.999);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(update); };

  // Size the word so it spans the footer's content width exactly.
  const fit = () => {
    const box = root.clientWidth - parseFloat(getComputedStyle(root).paddingLeft) * 2;
    if (box <= 0) return;
    word.style.fontSize = "100px";
    const natural = word.getBoundingClientRect().width;
    if (natural > 0) word.style.fontSize = `${Math.min(100 * ((box * 0.97) / natural), window.innerHeight * 0.55).toFixed(2)}px`;
    shown = -1;
    queue();
  };

  const onMove = (e) => {
    for (const el of letters) {
      const b = el.getBoundingClientRect();
      const inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top - 40 && e.clientY <= b.bottom;
      el.toggleAttribute("data-hot", inside);
    }
  };
  const onLeave = () => letters.forEach((el) => el.removeAttribute("data-hot"));

  document.addEventListener("scroll", queue, { capture: true, passive: true });
  window.addEventListener("resize", fit);
  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave);
  const ro = new ResizeObserver(fit);
  ro.observe(footer);
  fit();
  if (document.fonts) document.fonts.ready.then(fit);
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("scroll", queue, { capture: true });
    window.removeEventListener("resize", fit);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    ro.disconnect();
  };
}
