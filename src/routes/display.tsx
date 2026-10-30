import { createFileRoute } from "@tanstack/react-router";
import { Teleprompter } from "@/components/Teleprompter";

export const Route = createFileRoute("/display")({
  head: () => ({
    meta: [
      { title: "Teleprompter — Extended Display" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DisplayPage,
});

function DisplayPage() {
  return <Teleprompter displayOnly />;
}
