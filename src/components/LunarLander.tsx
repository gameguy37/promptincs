import { useEffect, useRef } from "react";
import Matter from "matter-js";

/**
 * 'Promptin Lander' easter egg. Turns the on-screen text blocks into rigid
 * static physics boundaries and drops a 🚀 that bounces and settles on the
 * script. Fully sandboxed: the engine, runner, RAF loop and canvas are all
 * created on mount and torn down completely on unmount — nothing persists and
 * the prompter DOM is never mutated, so it can't leak during a live show.
 */
export function LunarLander({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const engine = Matter.Engine.create();
    engine.gravity.y = 1;
    const world = engine.world;

    // Static boundaries from each visible text block / heading.
    const selectors = "[data-block-editor], [data-block-id] .whitespace-pre-wrap, .tp-block-heading";
    const els = Array.from(document.querySelectorAll<HTMLElement>(selectors));
    const staticBodies: Matter.Body[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > H) continue;
      const body = Matter.Bodies.rectangle(
        r.left + r.width / 2,
        r.top + r.height / 2,
        Math.max(8, r.width),
        Math.max(8, r.height),
        { isStatic: true, restitution: 0.4, friction: 0.6 },
      );
      staticBodies.push(body);
    }

    // Walls + floor so the lander can't escape the viewport.
    const wallOpts = { isStatic: true, restitution: 0.5 };
    const floor = Matter.Bodies.rectangle(W / 2, H + 30, W, 60, wallOpts);
    const leftWall = Matter.Bodies.rectangle(-30, H / 2, 60, H * 2, wallOpts);
    const rightWall = Matter.Bodies.rectangle(W + 30, H / 2, 60, H * 2, wallOpts);

    // The lander itself.
    const lander = Matter.Bodies.circle(W / 2 + (Math.random() * 120 - 60), -60, 26, {
      restitution: 0.55,
      friction: 0.3,
      frictionAir: 0.01,
      density: 0.002,
    });
    Matter.Body.setAngularVelocity(lander, (Math.random() - 0.5) * 0.2);

    Matter.Composite.add(world, [...staticBodies, floor, leftWall, rightWall, lander]);

    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const { x, y } = lander.position;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(lander.angle);
      ctx.font = "44px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🚀", 0, 0);
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      Matter.Runner.stop(runner);
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60]"
      style={{ pointerEvents: "none" }}
      aria-hidden
      onClick={onExit}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-sm border border-[#2a2a2a] bg-black/70 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#e85a5a]">
        🚀 Promptin Lander — ⌘⇧L to exit
      </div>
    </div>
  );
}
