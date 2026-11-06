// Pixel swarm for the "Beyond code" section (replaces the photo ring).
// About 1,600 square pixels live in 3D and morph between formations: an orbit ring around the
// title, a pixel globe, a wave field and a double helix. They turn slowly, tilt toward the cursor,
// scatter away from it, and assemble from a scattered cloud the first time the section comes into
// view. The colours come from the page palette and the speed from the frame time, and the swarm
// pauses offscreen. With reduced motion it draws the ring once and stays still.
// Injected verbatim into the landing bundle, so plain browser JavaScript only.
export default (canvas) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 1600;
  const TAU = Math.PI * 2;
  let w = 0, h = 0, dpr = 1, unit = 1;
  let colors = { ink: "#0b0b0f", blue: "#00a6ff", light: "#bfe6ff", bg: "#ffffff" };

  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const seeds = Array.from({ length: N }, () => [rnd(), rnd(), rnd()]);

  // Formations, as unit-scale 3D points (x right, y up, z toward the viewer).
  const ring = seeds.map(([a, b, c]) => {
    const t = a * TAU, band = (b - 0.5) * 0.22, r = 1 + (c - 0.5) * 0.16;
    return [Math.cos(t) * r * 1.55, band + Math.sin(t) * 0.05, Math.sin(t) * r * 0.95];
  });
  const globe = seeds.map(([a, b]) => {
    const y = 1 - 2 * b, rr = Math.sqrt(1 - y * y), t = a * TAU * 1.0;
    return [Math.cos(t) * rr * 1.05, y * 1.05, Math.sin(t) * rr * 1.05];
  });
  const wave = seeds.map((_, i) => {
    const cols = 64, x = (i % cols) / (cols - 1) - 0.5, z = Math.floor(i / cols) / (N / cols - 1) - 0.5;
    return [x * 3.6, Math.sin(x * 9) * 0.14 + Math.cos(z * 11) * 0.12 - 0.35, z * 2.2];
  });
  const helix = seeds.map(([a, b], i) => {
    const t = a * TAU * 2.2, side = i % 2 ? Math.PI : 0, r = 0.42 + (b - 0.5) * 0.06;
    return [(a - 0.5) * 3.4, Math.cos(t + side) * r, Math.sin(t + side) * r];
  });
  const shapes = [ring, globe, helix, wave];
  const scatter = seeds.map(([a, b, c]) => [(a - 0.5) * 7, (b - 0.5) * 5, (c - 0.5) * 6]);

  // Per-pixel state: current position and velocity (springs toward the target).
  const pos = scatter.map((p) => p.slice());
  const vel = seeds.map(() => [0, 0, 0]);
  const accent = seeds.map(([a, , c]) => (a * 997 + c * 131) % 1 < 0.035);

  let shape = 0, shapeAt = 0, assembled = still;
  let yaw = 0, pitch = -0.32, tiltX = 0, tiltY = 0;
  const mouse = { x: -1e4, y: -1e4, on: false, tx: 0, ty: 0 };

  const readColors = () => {
    const cs = getComputedStyle(canvas);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    colors = { ink: v("--palette-b100", colors.ink), blue: v("--palette-blue", colors.blue), light: v("--palette-blue-light", colors.light), bg: v("--palette-b0", colors.bg) };
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    unit = Math.min(w * 0.34, h * 0.42);
    readColors();
    if (still) draw(0);
  };

  const project = (x, y, z) => {
    // rotate (yaw around y, then pitch around x), then perspective
    const cy = Math.cos(yaw + tiltX), sy = Math.sin(yaw + tiltX);
    const cp = Math.cos(pitch + tiltY), sp = Math.sin(pitch + tiltY);
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const f = 3.2 / (3.2 - z2);
    return [w / 2 + x1 * unit * f, h / 2 - y1 * unit * f, z2, f];
  };

  const order = new Uint16Array(N);
  const proj = new Float32Array(N * 4);
  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < N; i++) {
      const p = pos[i];
      const q = project(p[0], p[1], p[2]);
      proj[i * 4] = q[0]; proj[i * 4 + 1] = q[1]; proj[i * 4 + 2] = q[2]; proj[i * 4 + 3] = q[3];
      order[i] = i;
    }
    order.sort((a, b) => proj[a * 4 + 2] - proj[b * 4 + 2]);
    const base = Math.max(2, Math.round(unit / 70));
    const clearW = Math.min(w * 0.36, 560), clearH = Math.min(h * 0.3, 260);
    for (let k = 0; k < N; k++) {
      const i = order[k];
      const x = proj[i * 4], y = proj[i * 4 + 1], z = proj[i * 4 + 2], f = proj[i * 4 + 3];
      const depth = (z + 1.2) / 2.4; // 0 far, 1 near
      let alpha = 0.28 + 0.72 * Math.max(0, Math.min(1, depth));
      // keep the title readable: pixels in front of it fade
      if (z > -0.2) {
        const dx = (x - w / 2) / clearW, dy = (y - h / 2) / clearH, d = dx * dx + dy * dy;
        if (d < 1) alpha *= 0.12 + 0.88 * d * d;
      }
      const s = Math.max(1.5, base * f * (0.75 + depth * 0.5));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = accent[i] ? colors.ink : depth > 0.55 ? colors.blue : colors.light;
      // snap to the device pixel grid so squares stay crisp
      const px = Math.round((x - s / 2) * dpr) / dpr, py = Math.round((y - s / 2) * dpr) / dpr;
      ctx.fillRect(px, py, s, s);
    }
    ctx.globalAlpha = 1;
    void dt;
  }

  let raf = 0, last = 0, visible = false, started = 0;
  function step(now) {
    raf = visible ? requestAnimationFrame(step) : 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!started) { started = now; shapeAt = now + 3200; }
    if (now > shapeAt) { shape = (shape + 1) % shapes.length; shapeAt = now + 5200; }
    yaw += dt * 0.18;
    mouse.tx += ((mouse.on ? (mouse.x / w - 0.5) * 0.5 : 0) - mouse.tx) * 0.05;
    mouse.ty += ((mouse.on ? (mouse.y / h - 0.5) * 0.35 : 0) - mouse.ty) * 0.05;
    tiltX = mouse.tx; tiltY = mouse.ty;

    const target = assembled ? shapes[shape] : scatter;
    const k = 7.5, damp = Math.exp(-dt * 5.2);
    for (let i = 0; i < N; i++) {
      const p = pos[i], v = vel[i], t = target[i];
      // stagger: each pixel answers the morph a little later than the last
      const lag = (seeds[i][0] * 0.6 + seeds[i][1] * 0.4) * 0.9;
      const go = now - (shapeAt - 5200) > lag * 1000 || !assembled ? 1 : 0.15;
      for (let a = 0; a < 3; a++) v[a] = (v[a] + (t[a] - p[a]) * k * go * dt) * damp;
      // cursor: push pixels away in screen space
      if (mouse.on) {
        const sx = proj[i * 4], sy = proj[i * 4 + 1];
        const dx = sx - mouse.x, dy = sy - mouse.y, d2 = dx * dx + dy * dy, R = 120;
        if (d2 < R * R && d2 > 1) {
          const push = (1 - Math.sqrt(d2) / R) * 6 * dt;
          v[0] += (dx / Math.sqrt(d2)) * push; v[1] -= (dy / Math.sqrt(d2)) * push;
        }
      }
      p[0] += v[0] * dt * 6; p[1] += v[1] * dt * 6; p[2] += v[2] * dt * 6;
    }
    draw(dt);
  }

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && e.intersectionRatio > 0.25) assembled = true;
    if (visible && !raf && !still) { last = 0; raf = requestAnimationFrame(step); }
  }, { threshold: [0, 0.25, 0.5] });
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.on = e.pointerType === "mouse";
  };
  const onLeave = () => { mouse.on = false; };
  const ro = new ResizeObserver(resize);
  const host = canvas.parentElement || canvas;
  const mo = new MutationObserver(readColors);

  if (still) for (let i = 0; i < N; i++) pos[i] = ring[i].slice();
  resize();
  ro.observe(canvas);
  io.observe(canvas);
  host.addEventListener("pointermove", onMove, { passive: true });
  host.addEventListener("pointerleave", onLeave);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-id"] });
  return () => {
    cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); mo.disconnect();
    host.removeEventListener("pointermove", onMove); host.removeEventListener("pointerleave", onLeave);
  };
}
