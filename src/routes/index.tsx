import { createFileRoute } from "@tanstack/react-router";
import { Teleprompter } from "@/components/Teleprompter";
import { UpdateNotification } from "@/components/UpdateNotification";
import { DebugOverlay } from "@/components/DebugOverlay";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  // Local-first: the editor and prompter are fully usable without a cloud
  // account. Sign-in is optional and only required for hosting a Play Along
  // Room; that gate lives inside Teleprompter's host action handlers.
  return (
    <>
      <Teleprompter />
      <UpdateNotification />
      <DebugOverlay />
    </>
  );
}
