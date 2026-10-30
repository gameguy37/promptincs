import { createFileRoute } from "@tanstack/react-router";
import { Teleprompter } from "@/components/Teleprompter";

export const Route = createFileRoute("/play/$sessionId")({
  head: () => ({
    meta: [
      { title: "Play Along Room — Circumsoft TRS-1" },
      {
        name: "description",
        content:
          "Join a live Play Along Room to read and collaborate on the script in real time.",
      },
    ],
  }),
  component: PlayAlongRoom,
});

function PlayAlongRoom() {
  // Teleprompter reads the session id directly from the URL (it understands the
  // /play/<sessionId> path form) and joins as a player client.
  return <Teleprompter />;
}
